# Outbound sequences — design for review

Status: **proposal, not built.** Nothing in this document exists in the code yet.
It covers requested items 1, 6 and 7. Items 2, 3, 4 and 5 are already
implemented on `feature/touch-logging-and-perf`.

Read the [Decisions needing your sign-off](#decisions-needing-your-sign-off)
section first — the rest is detail supporting those five choices.

---

## 1. What exists today, and why this is new work

There is **no sequencing feature in this codebase**. To be concrete about the
starting point:

| Requested                       | Exists today                                                 |
| ------------------------------- | ------------------------------------------------------------ |
| Sequences with steps            | Nothing. No table, no page.                                  |
| Per-lead per-step email copies  | Nothing.                                                     |
| Bulk review / approve queue     | `approval_request`/`approval_step` exist but are wired to quotes, invoices and timesheets — not email, and not built for 8,000 rows. |
| Scheduled sending with a daily cap | Nothing. `server/email.ts` sends immediately, inline, on a button press. |
| Reply detection                 | Nothing inbound. `email.threadId`/`messageId` columns exist but are only written on outbound sends. |
| Pause / resume a lead           | Nothing.                                                     |
| Campaigns                       | Attribution and ROI reporting only (`campaign`, `campaign_member`). |

So this is a new subsystem, not a modification. The estimate at the end reflects
that.

## 2. The flow being built

Exactly the flow described, with the stage names used throughout this document:

1. **Enrol** — leads are added to a campaign.
2. **Build** — a sequence is created: ordered steps, each with a subject and
   body template and a delay from the previous step.
3. **Generate** — one `sequence_email` row per (lead × step). 1,000 leads × 8
   steps = 8,000 rows, all `PENDING_REVIEW`.
4. **Review** — the user reads and approves emails; each moves to `APPROVED`.
   Two columns, filters, analytics.
5. **Launch** — the sequence is finalised and started. From here the scheduler
   owns sending, respecting a daily cap.
6. **Monitor** — reports only, plus finding a lead and pausing it when a reply
   arrives. A paused lead's remaining steps stop; it can be resumed.

## 3. Schema

Five new tables. Names follow the existing convention (singular, snake_case
table, quoted camelCase columns).

```
sequence
  id, campaignId → campaign, name, status, dailyCap,
  sendWindowStart/End, sendDaysOfWeek, timezone,
  ownerUserId, generatedAt, launchedAt, createdAt, updatedAt, deletedAt

sequence_step
  id, sequenceId → sequence, stepNumber, name,
  subjectTemplate, bodyTemplate,
  delayDays, delayHours          -- from the previous step
  UNIQUE (sequenceId, stepNumber)

sequence_enrollment              -- one lead's journey through one sequence
  id, sequenceId, leadId → lead, status, currentStepNumber,
  pausedAt, pausedReason, pausedByUserId, resumedAt,
  completedAt, replyDetectedAt
  UNIQUE (sequenceId, leadId)    -- a lead cannot be enrolled twice

sequence_email                   -- the reviewable, sendable unit
  id, enrollmentId, stepId, sequenceId, leadId,   -- last two denormalised, see below
  status, subject, bodyHtml, bodyText,            -- rendered at generation
  scheduledAt, sentAt, failedAt, failureReason,
  approvedByUserId, approvedAt,
  emailId → email,                                -- the delivery record
  messageId, threadId
  UNIQUE (enrollmentId, stepId)                   -- idempotent generation

sequence_event                   -- append-only audit of everything that happened
  id, sequenceEmailId, enrollmentId, eventType, occurredAt, actorUserId, detail jsonb
```

### Why `sequence_email` carries `sequenceId` and `leadId` too

They are reachable through `enrollmentId`, so this is deliberate denormalisation.
The review queue's filters are almost all *lead* attributes (email address,
company, owner, status) combined with *sequence* scoping, and the daily-cap query
counts sent rows per sequence per day. Going through `sequence_enrollment` for
every one of those turns each filter into a join against a table with one row per
lead. Both columns are immutable after generation, so there is no update path
that could let them drift from the enrollment.

### Statuses

`sequence.status`
`DRAFT → GENERATING → PENDING_REVIEW → READY → RUNNING → PAUSED → COMPLETED`

A sequence cannot reach `READY` while any of its emails is `PENDING_REVIEW`, and
it cannot go back to `DRAFT` once launched — see §4.

`sequence_enrollment.status`
`ACTIVE → PAUSED → COMPLETED`, plus `REPLIED` (the "reply received" column) and
`STOPPED` (manually ended for good).

`sequence_email.status`
`PENDING_REVIEW → APPROVED → SCHEDULED → SENDING → SENT`, plus `FAILED`,
`SKIPPED` (its lead was paused before this step came due) and `CANCELLED`.

`SENDING` is a real state, not a transient one. It is what makes the claim step
in §5 crash-safe: a row stuck in `SENDING` is a row whose worker died mid-send,
and it is recoverable by inspection rather than silently re-sent.

## 4. The immutability question this raises

The requested flow has the user approve all 8,000 emails, then launch. That only
means anything if an approved email cannot change afterwards. Otherwise
"approved" is decoration — someone edits a step after approval and 6,000
unreviewed emails go out over the following weeks bearing an approval that was
given for different copy.

So the proposal is:

- Editing a `sequence_step` after generation is **blocked** while the sequence is
  `READY` or `RUNNING`.
- To change copy, the user edits the step and **re-generates**, which returns
  every not-yet-sent email on that step to `PENDING_REVIEW`. Already-sent emails
  are untouched history.
- The `sequence_email` body is rendered and frozen at generation time. What was
  approved is what is sent, byte for byte.

This is the one place where I am proposing something stricter than what was
described, and it has a cost: fixing a typo in step 6 means re-approving step 6
for every lead. §"Decisions" asks whether you want a bulk "approve all on this
step" affordance to make that bearable.

## 5. Scheduler — Supabase pg_cron + Edge Function

Per your choice. The split is: **Postgres decides what to send, the Edge Function
does the sending.**

```
pg_cron (every 15 min)
   └─ select sequence_claim_due_emails(p_limit)   -- SECURITY DEFINER, in Postgres
        │  claims rows atomically, returns them
        └─ pg_net posts the claimed batch to the Edge Function
             └─ Resend send, one row at a time
                  └─ writes back SENT / FAILED + messageId

pg_cron (nightly)
   └─ select sequence_schedule_next_day()          -- assigns scheduledAt honouring the cap
```

### Claiming, and why it is the crux

Two cron ticks overlapping, or a retry after a timeout, must not send the same
email twice — a duplicate outbound email to a prospect is the one failure mode
that is visible to the customer and cannot be undone. The claim is therefore a
single atomic statement:

```sql
update sequence_email
   set status = 'SENDING', "claimedAt" = now()
 where id in (
   select id from sequence_email
    where status = 'SCHEDULED' and "scheduledAt" <= now()
    order by "scheduledAt"
    limit p_limit
    for update skip locked        -- concurrent ticks take disjoint sets
 )
returning *;
```

`FOR UPDATE SKIP LOCKED` is what makes concurrent ticks safe. `SENDING` rows
older than a threshold are surfaced as a stuck-send report rather than
auto-retried, because an automatic retry cannot distinguish "Resend never got it"
from "Resend got it and our write-back failed" — and those two differ by whether
the prospect already has the email.

### The daily cap

`sequence.dailyCap` (your 20–30/day) counts **every** email in the sequence,
followups included, matching what you asked for. The nightly function walks
`SCHEDULED`-eligible emails in order — step order within a lead, then enrollment
order — and assigns `scheduledAt` slots inside the send window on permitted
weekdays until the day's cap is used, then moves to the next day.

Two consequences worth stating plainly, because they surprise people:

- 8,000 emails at 25/day is **320 working days**. A cap that low with a list that
  large is a multi-year sequence. Either the cap is per-mailbox and there are
  many mailboxes, or the list needs splitting, or the cap is higher than the
  example. This needs your input — see Decisions.
- A step's real delay is `max(step delay, when the cap allows it)`. The cap wins,
  because exceeding it is what gets a sending domain blocked.

### Why not Vercel Cron

Only that you chose pg_cron. For the record, the tradeoff: pg_cron keeps
scheduling independent of the Next host and puts the claim in the same
transaction boundary as the data, which is the safer half of the problem. It
costs a second deployment artefact (the Edge Function) and a second place secrets
live, and Edge Functions run Deno rather than the Node code in `server/email.ts`,
so **the branded-email rendering in `lib/email-template.ts` has to be reachable
from both**. Plan: render at *generation* time in the Next app and store the
final HTML on the row, so the Edge Function only transports what is already
rendered and never imports the template code at all. This also happens to be what
makes approval meaningful (§4), so the two constraints agree.

## 6. Reviewing 8,000 emails without falling over

`supabase/config.toml` sets `max_rows = 1000`, and `LIST_LIMIT` in `lib/db.ts` is
500. An 8,000-row queue cannot be listed, and no user reads 8,000 emails in one
sitting regardless.

- **Keyset pagination**, not offset. `order by ("scheduledAt", id) > (last seen)`.
  Offset pagination on 8,000 rows re-scans from the top on every page.
- Server-side counts by status for the two column headers, via one grouped
  aggregate — never by fetching rows and counting in JS.
- The list fetches only what a review card shows (id, lead name, company, subject,
  step number, status). Bodies are loaded for the one email being read.
- **Bulk approve within the current filter** is, I think, unavoidable at this
  volume. One-by-one approval of 8,000 emails at 5 seconds each is 11 hours. See
  Decisions.

### Filters (item 6)

Per sequence and campaign: step number, status, lead status, lead owner, company,
email address contains, scheduled-date range, approved-by, has-replied,
enrollment status. Composed the same way the existing list pages compose
filters, so the URL stays shareable — consistent with the `ListFilters`
comment about the search living in the URL.

Indexes to add alongside:
`(sequenceId, status, scheduledAt)`, `(leadId)`, `(enrollmentId, stepId)`,
`(status, scheduledAt) where status = 'SCHEDULED'`.

## 7. UI (item 7)

Four screens. The existing `PageHeader`/`Card`/`StatTile`/`Table` primitives
throughout, with the column priorities from the pass just committed.

**`/sequences`** — the card grid you asked for. One card per running sequence:
name, campaign, status, a progress bar of sent/approved/total, today's sent count
against the cap, replies received, next send time. This is the "see every current
sequence running" view.

**`/sequences/[id]`** — one sequence. Tabs: Overview (funnel per step: sent →
opened if available → replied), Steps (the builder; locked once launched per §4),
Enrollments (per-lead progress, where a lead is paused), Report.

**`/sequences/[id]/review`** — the two-column queue. Not-approved on the left,
approved on the right, counts in the headers, the filter strip above. A card
shows the rendered email with the merge fields filled, the lead it goes to, and
its step. Keyboard `a` to approve and advance — at these volumes the mouse is the
bottleneck. A third column appears for **Reply received** once any enrollment is
in that state, which is where a paused lead lands, as requested.

**`/sequences/[id]/report`** — per-step and per-lead detail, exportable through
the existing `ExportButton`.

## 8. What I would build, in order

Each stage ends somewhere usable rather than half a feature:

1. Schema + RLS + indexes. Migration only, nothing user-visible.
2. Sequence and step CRUD, `/sequences` list and detail. No generation yet.
3. Generation, plus the review queue with filters and single approve.
4. Bulk approve, analytics, the report screen.
5. `sequence_claim_due_emails`, the nightly scheduler, the cap logic. Tested
   against the clock with no real sending — a dry-run mode that marks rows sent
   without calling Resend.
6. The Edge Function and real sending. Behind an explicit enable so a
   half-configured deploy cannot start mailing prospects.
7. Pause/resume, the Reply-received column, stuck-send reporting.

Stages 1–4 are where most of the requested value is and they need no cron or
Edge Function at all. If you want to see something working sooner, stopping after
4 gives you the whole review-and-approve product with sending still manual.

## 9. Cost and risk, honestly

Roughly 3,500–5,000 lines: ~8 migrations, a `server/sequences.ts` comparable in
size to the existing `server/crm.ts`, one Edge Function, four pages plus
components, and tests for the cap arithmetic and the claim.

The parts most likely to bite:

- **Double-sending.** Mitigated by the claim, but this is where I would want the
  most test coverage. Duplicates reach the customer.
- **The cap arithmetic vs. reality.** 320 days for the example numbers.
- **Deliverability.** 8,000 cold emails from one domain is a reputation question
  this design cannot answer. The cap exists because of it.
- **Two runtimes.** Rendering at generation keeps the template in one place;
  drifting from that plan means maintaining branded HTML in both Node and Deno.
- **Reply detection is manual for now**, per your choice. The pause/resume
  machinery and the Reply-received column are built; nothing watches the inbox,
  so a reply that nobody notices keeps receiving followups. Wiring the Resend
  inbound webhook later touches only `sequence_enrollment`.

## Decisions needing your sign-off

1. **The cap and the list size.** 25/day against 8,000 emails is 320 working
   days. Is the cap per-sending-mailbox with several mailboxes, is the real list
   smaller, or is the cap higher? This changes the scheduler's shape, not just a
   constant.
2. **Bulk approve.** One-by-one over 8,000 emails is ~11 hours of reading. Do you
   want "approve all matching the current filter", accepting that it is
   approval-by-sampling? Without it the review stage is impractical at this
   volume; with it, the guarantee in §4 is weaker than it looks.
3. **Locking steps after launch.** §4 blocks copy edits on a launched sequence
   and forces re-approval. Correct, but it means a typo in step 6 costs a
   re-approval pass. Accept, or allow edits with a loud warning?
4. **Stop after stage 4?** Stages 1–4 deliver the sequence builder and the entire
   review/approve/report product with no scheduler. Sending stays manual until
   stage 6. Worth having earlier, or do you want it all in one go?
5. **Whose mailbox.** Every send currently goes from `EMAIL_FROM` via Resend. Do
   sequence emails come from the lead owner's address instead? That is a
   deliverability and Resend-domain-verification question, and it affects the
   schema (a `fromUserId` on the sequence or the step).
