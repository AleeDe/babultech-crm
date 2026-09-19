# Staff pilot runbook

For the people who will actually use these workflows. Written 19 September 2026.

Everything built so far has been checked against synthetic data by automated
tests — 85 browser checks and 518 unit tests. None of it has been used by a
real person doing real work. That is what this pilot is for, and it is the only
thing that can tell us whether these workflows fit how the team actually works.

**Nothing here is a test you can pass.** If a step feels wrong, takes too long,
or asks for something you do not have, that is the finding. Write it down.

---

## Before you start: what is actually blocked today

Three of the five workflows cannot be piloted yet. This is not a fault in the
software; it is that the access grants and the data are not there.

### 1. Nobody except the administrator can open the leads workflows

`lead:read` is held only by `admin@babultech.com`. Everyone else — Finance, the
Project Manager, all three Consultants — gets a "Forbidden" page at
`/leads/calling`, `/leads/handoffs` and `/leads/research`.

The sales handoff needs more than that: one person must hold `lead:read`,
`lead:write` **and** `opportunity:write` together to appear in the recipient
picker. Today only the administrator does.

**Decide before piloting:** who is doing outbound calling, and who receives a
qualified lead? Those two people need the grants above.

### 2. There are no leads, customers, contracts or invoices

The database currently holds 10 projects and 6 tasks. Leads: 0. Customer
accounts: 0. Contracts: 0. Invoices: 0.

So the calling queue, the research queue, renewals, account health and the whole
finance path have nothing to show. They are not broken — there is nothing in
them.

**Decide before piloting:** does real work go in first, or does the pilot wait
until it does? Do not create fake leads or invoices to exercise the screens.
A pilot on invented data tells you what the automated tests already told you.

### 3. Some steps need a second person, and there is only one

Two rules deliberately require two different people:

- **Content review.** Whoever wrote a version cannot approve it. Only Sami Ullah
  and the administrator hold `project:manage`, so if Sami writes it, only the
  administrator can review it, and the other way round.
- **Issuing an invoice.** Whoever prepared an invoice cannot issue it. Only
  Hassan Shamsi and the administrator can issue, so if Hassan prepares it, only
  the administrator can issue it.

These are working as intended — one person should not be able to both raise and
approve the same thing. But it means the pilot needs the administrator to take
part, or a second person granted the same rights.

### Who can reach what, today

| Person | Role | Calling & handoffs | Content review | Draft invoices | Issue invoices |
| --- | --- | --- | --- | --- | --- |
| Babul Tech (admin) | Administrator | Yes | Yes | Yes | Yes |
| Hassan Shamsi | Finance | No | No | Yes | Yes |
| Sami Ullah | Project Manager | No | Yes | No | No |
| Muhammad Ali | Consultant | No | No | No | No |
| Muhammad Hussain | Consultant | No | No | No | No |
| Shabbir Writes | Consultant | No | No | No | No |

Consultants can work on projects and their own tasks, and file expenses. They
cannot administer projects: that now needs `project:manage`, which they do not
have.

---

## What can be piloted now

Only the content workflow, and only between Sami Ullah and the administrator,
because the projects and tasks already exist.

Everything else is waiting on the grants and the data above.

---

## Content: plan, write, review, publish

**People:** a project manager (Sami), a writer (any consultant assigned to the
task), and a second person with `project:manage` to review (the administrator).

### Sami — set the plan

1. Open a project → **Content calendar**.
2. **Plan an existing content task.** The picker only shows open tasks on that
   project, so create and assign the task first if it is not there.
3. Fill in channel, format, objective, audience, brief, and the planned publish
   time. Times are Pakistan time throughout.
4. Decide whether client approval is required. If you say yes here, the work
   cannot be published until a client decision is recorded.

*Watch for:* is the brief field the right shape for how you actually brief
people? Is anything missing that you would normally say?

### The writer — save a version

1. From the calendar item → **Versions, approvals & publication**.
2. **Create version 1.** Paste the exact copy that would go out.
3. Optionally add an asset URL and its SHA-256.

*Important:* the CRM stores the URL and the hash. It does not download, freeze
or verify the file. If the file behind that URL changes, nothing here notices.
Whoever reviews it has to check the file against the recorded hash themselves.

*Watch for:* is saving a version quick enough to be worth doing, or would people
skip it? Is the hash step realistic, or will it always be left empty?

### The administrator — review it

1. Open the same page. The review form only appears for someone who did *not*
   write the version.
2. Approve, or request changes, with your reasoning.
3. If the plan required client approval, the client step comes next.

*Watch for:* is "approve or request changes" enough, or do you need a middle
option? Does the version history make sense when there are several?

### Client approval — the client decides for themselves

If the plan requires client approval, after internal approval you will see
**Client review link**.

1. Enter the client contact's name and email, choose how long the link lasts.
2. **Create review link.** The link appears once and cannot be shown again.
   Copy it.
3. Send it yourself — by email, WhatsApp, however you normally reach them.
   Nothing is sent from the CRM.
4. The client opens it with no account and no password, reads the brief and the
   copy, and records their own decision with their name.

*What the client sees:* the task name, channel, format, objective, audience,
brief, the copy, and the asset link. Nothing else — no internal notes, no staff
names, no other clients, no CRM navigation.

*Important:* anyone holding that link can use it. It is the credential. Send it
to the right person and do not post it in a shared channel. It expires on its
own, and you can withdraw it while it is unused.

*Watch for:* do clients actually open it? Is the page understandable to someone
who has never seen our system? Does the decision come back faster than chasing
an email thread?

### After publication

Once approved, record the publication: the live URL and the time it actually
went out. The CRM does not publish anything or check the URL — this is evidence
that it happened.

**A new version starts the approvals again.** Old approvals never carry over to
changed copy, and published evidence stays attached to the version that actually
shipped.

---

## The rest, once unblocked

Written out so the shape is clear, not because they can be run today.

### Leads: calling queue → qualification → sales handoff

**Needs:** `lead:read` + `lead:write` for the caller; `lead:read` +
`lead:write` + `opportunity:write` for the receiving salesperson; and some real
leads.

1. Caller opens **Leads → My calling queue**, filtered by Needs scheduling or
   All open. Only leads assigned to them appear.
2. After a real call: record the outcome, notes, and a future follow-up. This
   records a call you made — it does not dial anyone.
3. Recording a call does not change the lead's status. That is deliberate.
4. To hand a lead to sales: open the lead → **Qualification & sales handoff**,
   fill in the discovery context, choose the salesperson, submit. The lead is
   marked Qualified but stays yours until they accept.
5. The salesperson opens **Leads → Sales handoffs**, reads the brief, and
   accepts with a dated next action, or returns it with a reason.
6. Nobody is notified by email. The recipient has to check the page.

*Watch for:* is the qualification form asking for things you genuinely know at
that point? "Unknown" is a valid answer — is it used honestly, or does it become
the default?

### Delivery: won deal → handoff → project kickoff

**Needs:** a won opportunity, an accepted quotation, and a planning project
linked to both.

1. PM creates the planning customer project against the won opportunity and the
   same account.
2. Sales opens the opportunity → **Delivery handoff** → completes the checklist:
   contact, scope, deliverables, exclusions, dates, billing, payment evidence,
   acceptance criteria, revisions, promises and risks.
3. PM opens **Projects → Delivery handoffs** and accepts with a kickoff date, or
   returns it with a reason.
4. Acceptance records readiness. It does **not** activate the project — that is
   still a separate step in project edit.
5. Payment status is a declaration, not a check against the ledger. `PENDING`
   blocks acceptance.

*Watch for:* is the checklist the right length? A checklist people rush through
is worse than a shorter one they complete honestly.

### Finance: recurring billing, issuing, closing a month

**Needs:** contracts with an end date and a billing frequency; a second person
who can issue invoices.

1. **Invoices → Billing run → Bill contract periods** raises one draft per
   contract period that has started and has not been billed. Safe to run twice.
2. Someone other than the preparer issues each invoice.
3. **Finance → Periods** closes a finished month once the books are agreed. The
   current month cannot be closed. After closing, that month's invoices,
   payments and expenses cannot be changed.
4. Reopening needs the same authority and a reason, and is recorded.

*Watch for:* does the period amount (contract value divided by its periods)
match how you actually bill? Is closing a month something you would do monthly,
or does it need to wait for something else first?

### Renewals and account health

**Needs:** contracts with end dates, and customer accounts.

- **Contracts → Renewals** shows what ends within 30, 60 or 90 days, lapsed ones
  first, with the notice deadline and the named account manager.
- **Accounts → Account health** reads the records — overdue invoices, breached
  support cases, silence, approaching renewals — and shows every signal it
  counted.

*Important:* the stored health field is never overwritten. Where your judgement
and the records disagree, both are shown.

*Watch for:* do the health signals match your sense of which customers are
actually struggling? If a customer you know is fine reads RED, the weights are
wrong and should be changed.

---

## How to report what you find

One line per thing, as it happens. Do not save them up.

- **What you were doing** — the screen and the step.
- **What you expected**, and **what happened**.
- **Whether you could carry on**, or had to stop.

The most useful findings are the ones that are not bugs: a step that takes too
long, a field nobody knows how to fill in, a workflow that does not match how
the work really flows. The software doing exactly what it was built to do, when
that turns out to be the wrong thing, is the single most valuable thing this
pilot can find.

## What this pilot cannot tell us

- Whether anything holds up at real data volumes. Everything so far has been
  tested with a handful of records.
- Whether the access rules are right for the team as it grows. They have been
  checked for correctness, not for whether they match how people actually need
  to work together.
- Whether the client-facing page works for clients. Only real clients opening
  real links can answer that.
