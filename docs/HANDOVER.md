# BabulTech CRM — what has been built

A record of what exists, what it enforces, what has been tested, and what has
not been built yet. Written to be read by someone who was not in the room.

> **Out of date in places.** This is the first handover. Since then the stack
> moved to Supabase (Postgres, Auth and row-level security) and email sending
> was added. On 28 September 2026 the partner and sales model was redesigned:
> the commission engine, deal registration windows and payouts were replaced
> by one commission record per deal; quotes are priced like their deals;
> partners work their own leads, customers, deals, quotes and items in the
> portal; and every salesperson sees every partner's records. The sections on
> sales, quotations, partners, users and the portal below describe the current
> model. For access rules see [roles-and-access](roles-and-access.md).

Stack: Next.js 15 (App Router) · TypeScript · PostgreSQL 16 + Prisma 6 · Tailwind · Auth.js

| | |
|---|---|
| Pages | 65 |
| Server modules | 13 (~6,900 lines) |
| Application code | ~23,000 lines across 139 tracked files |
| Database | 65 tables, 8 views, 67 enums |
| Migrations | 3 |
| Security roles | 8 |

---

## 1. How to run it

Full setup instructions are in the [README](../README.md) §2. The short version,
on a machine that already has Node 22 and PostgreSQL 16:

```bash
npm install
npx prisma migrate deploy
psql babultech_crm -f prisma/sql/01_constraints.sql   # CHECK constraints + triggers
psql babultech_crm -f prisma/sql/02_views.sql         # reporting views
npm run db:seed
npm run dev
```

Two things that bite people:

- Homebrew's PostgreSQL has **no `postgres` role** — the role is your macOS
  username with no password, so `DATABASE_URL` needs `postgresql://<you>@localhost:5432/...`.
- Pass the **database name** to `psql`, not `$DATABASE_URL` — libpq rejects the
  `?schema=` parameter Prisma requires.

**Re-run both SQL files after every `prisma migrate`.** They hold the CHECK
constraints, triggers and views that Prisma's schema language cannot express,
and a migration does not know about them.

---

## 2. The shape of the system

Three layers, and only two of them enforce anything:

| Layer | File | Enforces? |
|---|---|---|
| Middleware | `middleware.ts` | **No.** A cookie-presence check to bounce anonymous traffic. It runs on the Edge runtime and cannot reach the database. Never rely on it. |
| Pages | `src/app/**/page.tsx` | Yes — each checks the session's role before reading anything. |
| Server actions | `src/server/*.ts` | Yes — the real gate. Every mutation authorizes, validates with Zod, and returns a typed result. |
| Database | `prisma/sql/*.sql` | Yes — the backstop. CHECK constraints and triggers that hold even if the application is wrong. |

Business rules live in the **server layer**, not the forms. Every rule below was
tested by attempting to break it through a direct HTTP call to the action,
bypassing the UI entirely.

---

## 3. Modules

### Sales — Accounts, Contacts, Leads, Opportunities

Full create/edit. Leads convert into an account, a contact and optionally a
deal, carrying any partner referral through to the new opportunity.

Enforced:
- A **converted lead is read-only** — the edit page shows where it went instead of a form.
- **Disqualifying requires a reason.**
- **No second record for the same person.** A new lead is refused when its
  email, phone or WhatsApp number is already on a lead or a contact; a new
  contact when it matches a contact. Numbers match on their last nine digits.
  Imports skip matches and list them; a partner is told a match exists without
  seeing it.
- A deal is priced by its **products and services**: each line has a price book
  entry, a quantity and unit price, four costs (licence, maintenance, cloud, AI),
  a discount and a tax rate, and the deal's amount is the lines' total, tax
  included. Discount comes off the line **before** tax.
- **Closed Won** needs an amount, at least one line and an accepted quote, and
  starts the delivery project; **Closed Lost** needs a reason.
- **Every partner's records are every salesperson's**, whoever owns them - see
  [roles-and-access](roles-and-access.md).

### Quotations

A versioned document, not a form. Once sent it cannot be edited — it is
**revised into a new version**, and the original stays on record as what the
customer was actually shown. Only **one version per opportunity can be
accepted**, enforced by a partial unique index and re-checked in the action.

A quote is **priced exactly like its deal** - the same price book, the four
costs, discount and tax on every line, and the same generated totals. A new
quote starts as a copy of the deal's lines, every value editable.
**Accepting a quote copies its lines onto the deal** (`accept_quotation`), so
the deal's amount - and the partner's commission - becomes what the customer
accepted, and moves the deal to Verbal Confirmation. It is also the gate
Closed Won requires.

A quote a **partner** prepares is approved by somebody with `quotation:approve`
before it can be sent: it waits in Approvals under the partner's name, and is
approved, or sent back with a reason, from our quote page. A partner quote that
changes after approval needs approving again.

### Contracts

Create/edit, seeded from an accepted quote. An **active contract needs a
signature date**; a terminated one needs a reason and cannot be terminated while
live projects run under it.

### Support Cases

A case belongs to a customer **and to one of that customer's contacts** — the
contact dropdown narrows to the chosen account, and the server re-checks the
relationship so a crafted request cannot get around it.

Enforced: an open case needs an owner or a team (mirroring the database's
`case_assignment_check`); resolving or closing requires a resolution; SLA
deadlines are set from the priority's policy; `slaBreached` is computed on first
response and on resolution.

> ⚠️ SLA deadlines are **elapsed hours, not business hours**.
> `BusinessHours.weeklySchedule` exists but the calendar walk is unwritten, so a
> "4 hour" policy means four real hours including overnight.

### Projects and delivery

A workspace per project: phases, milestones with billing triggers and customer
sign-off, a task board with hierarchy and assignment, the team with allocation
percentages and rates, and a RAID log.

**Progress rolls up; it is never typed in.** Task completion weighted by
estimated hours drives phase completion drives project completion. Verified: a
30-hour task and a 10-hour task, complete the 30-hour one, the project reads
exactly 75%.

Enforced: only active project members can be assigned tasks or book time; a task
cannot complete with open subtasks; a project cannot complete with open tasks; a
milestone needing sign-off cannot complete without it.

### Timesheets and resources

Draft → submitted → approved, the standard PSA workflow. **Rates are snapshotted
onto each entry** from the project membership, so re-rating someone next year
cannot rewrite what last year's work cost. **Approved time is locked** against
edit and delete. **You cannot approve your own time.**

Resource utilisation compares booked allocation against logged hours, with a
billable ratio.

### Billing and cash

Draft/issue split. Two billing runs — completed milestones, and approved
time-and-materials grouped by person and rate — both producing **drafts**, so
nothing reaches a customer without someone issuing it. Both are **idempotent**.

Payments are recorded and applied across open invoices in one pass, with an
"apply oldest first" helper and a live unapplied figure.

`paidAmount` and `outstandingAmount` are recomputed in **exactly one place**,
from **cleared allocations only** — a cheque that has not cleared is not
payment. That is what makes the AR ageing view trustworthy.

Refuses: overpaying an invoice, paying a draft invoice, cross-currency
application, editing an issued invoice.

### Partners and commission

Partners are companies (backed by an Account of type Partner) **or individuals**
(a Contact with no account at all) — a freelance referrer needs no fake company.
A CHECK constraint plus a trigger enforce that it is one or the other, never
both.

A deal has **at most one partner**, `opportunity.sourcePartnerId`, carried from
the partner's lead or customer, or set by hand.

**One Partner Commission record per partner deal**, created with the deal:
the partner's % (copied from the partner), the deal's final amount after
discounts with tax included, the commission, withholding tax at the partner's
rate, and what the partner receives. It is **In progress** until it is marked
**Paid** or **Rejected**; a lost deal rejects it and reopening the deal
restores it. The payment date is set when the deal is won, 90 days on, and a
paid or rejected record is locked. A partner can ask for a different % with a
reason, which somebody with `commission:approve` approves or declines.

The earlier engine - plans, tiers, registration windows, payouts, adjustments
and clawbacks - was removed on 28 September 2026.

### Users and roles

A user is a login, a profile and a role at once. The role is the only thing the
app enforces: `permissions` is the ceiling, `dataScope` narrows which rows it
applies to, and both are read server-side on every page and action.

| Role | Scope |
|---|---|
| Super Admin | ALL |
| Manager | TEAM |
| Consultant | OWN |
| Partner | OWN (external) |
| Customer | OWN (external) |

Two lockouts are prevented because neither has a way back through the UI:
**you cannot deactivate your own account**, and **the last active administrator
cannot be demoted or deactivated**.

### Partner portal

External partners sign in at the same `/login` and land on `/portal`, where
they work their own business as our sales team works theirs:

- **Leads** - create, import, edit, email one or many (from BabulTech's address,
  with the partner as reply-to), log calls and meetings, set follow-ups, convert.
- **Accounts and contacts** - add and edit.
- **Opportunities** - edit, move through the stages, close Won (on an accepted
  quote) or Lost (with a reason). Owner and campaign stay ours.
- **Products and services on a deal** - the same card as our deal page, priced
  from our price books.
- **Quotations** - prepared with the same form our team uses, approved by us,
  then emailed or marked sent; the partner records the customer's answer and
  revises.
- **Products & Services** - BabulTech's read-only, and their own company's,
  which they add and edit.
- **Commission** - their record on each deal; they can ask for a different %
  and mark it paid once received.

**Isolation is enforced from both ends, independently** — the internal layout
redirects anyone with a `partnerId` to the portal; the portal layout redirects
anyone without one back to the app. Neither depends on the other, so a mistake
in one does not open the other. The portal has its **own shell**, not the
internal nav with items hidden.

Every portal read goes through the partner's own session, so row-level
security returns only their records; every portal write is a `partner_*`
database function that checks the record is theirs first. No portal function
accepts a partner id as an argument, so there is no parameter to tamper with.

#### Clashes

A partner's new lead or contact that matches somebody already on file - by
email, phone or WhatsApp - is refused like anyone's, and the partner is told a
match exists without being shown it. A customer the partner adds, or renames,
to a company that is already somebody else's is saved but flagged
`registrationContested` for a person to decide. Nothing is resolved
automatically.

---

## 4. Bugs found and fixed during testing

Each was found by testing behaviour, not by reading code:

1. **Stage probability silently zeroed.** `probabilityPercent` used Zod's
   `.optional()` without `.nullable()`, so a blank field coerced `null → 0` and
   beat the stage default. A Negotiation deal was saving at 0% instead of 75%.

2. **Project manager's time cost nothing.** `createProject` auto-adds the manager
   to the team but did not inherit their standing rates the way `addProjectMember`
   does, so their hours booked at zero cost and overstated project margin.

3. **Milestone billing was not idempotent.** `invoicedAt` is only stamped when an
   invoice is *issued*, so running the billing run twice raised two draft invoices
   for the same milestone — exactly how a customer gets billed twice.

4. **Registration expiry never fired.** The commission engine already refused to
   accrue against a lapsed registration, but nothing ever set an expiry, so the
   rule had never run once.

5. **Missing `id` in two Prisma selects**, so links had nothing to point at.

6. **Permission failures returned a 500 with the raw error.** Access was correctly
   blocked, but that is the wrong way to say "you do not have permission".

---

## 5. Known gaps

Honest list of what is **not** built:

- **No outbound email.** The `Email` entity is modelled but nothing sends. Partner
  registrations raise a dated **task** for the partner manager instead — that is
  what "notify" means today.
- **SLA business-hours arithmetic** — elapsed time only, as above.
- **Currency conversion** is modelled (`Currency.exchangeRate`) but single-rate.
  Multi-currency reporting needs dated rates and a decision about booking at
  invoice date or payment date. That is a finance decision, not a technical one.
- **Document storage** — `Document` holds metadata and a `storageUrl`; no object
  store is wired.
- **Campaigns, Products and Activities are read-only** — they have list and
  detail pages but no create/edit.
- **Approvals engine, forecasting and integrations** (spec Phase 5) are not started.
- **No automated test suite.** Everything below was verified by driving the real
  application against the real database; none of it is guarded against regression.

---

## 6. What was verified, and how

Every claim here was checked against the live database by calling server actions
directly over HTTP — bypassing the UI, the way an attacker or a bug would.

| Area | Checked |
|---|---|
| Quote maths | 3 × 100,000 less 10% → tax charged on the discounted 270,000, not the gross; total 318,600 |
| Cash cycle | Issue → part payment → `PARTIALLY_PAID` with correct outstanding and unapplied credit → settle → `PAID`, 0.00 outstanding |
| Progress roll-up | 30h + 10h tasks, complete the 30h → project reads exactly 75% |
| Commission | 10% of 600,000 → 60,000 accrued, and **0** when the same deal's registration had lapsed |
| Tier windows | Registered 60 / Silver 90 / Gold 120 / Platinum 180; override beats tier; GOLD conversion stamped exactly 120 days |
| Portal isolation | Partner → 9 internal routes all redirect to `/portal`; employees and anonymous users redirected out of the portal |
| Portal scoping | Two partner logins see disjoint commission and deal sets; the shared 70/30 deal correctly appears for both; zero bank-detail or cost-rate leakage |
| Refusals | Overpayment, draft-invoice payment, second accepted quote, non-member task assignment, self-approval of time, last-admin demotion, self-deactivation, weak password, orphan partner user, duplicate email — all refused with nothing written |

All test data was removed afterwards and the seed left intact. The
Commission and Tier windows rows describe the engine replaced on
28 September 2026; its replacement is covered by `scripts/test-lead-to-commission.mjs`
and the partner suites (`scripts/test-partner-*.mjs`).

---

## 7. Before this goes near production

1. **Change the demo passwords.** `prisma/seed.ts` contains `BabulTech@2026` in
   plain text for four accounts. Fine for a private repo and a demo database;
   not fine anywhere real.
2. **Confirm which quotes need approval.** Today every quote a partner prepares
   does, and none of our team's. Widening that is a rule in
   `20260928000006`, not a setting.
3. **Set cost and billing rates on every user** — without them, margin and
   utilisation read zero.
4. **Seed case categories** — the dropdown is currently empty and cases save as
   Uncategorised.
5. **Review `npm audit`.** There are high-severity advisories in transitive dev
   dependencies. Do **not** run `npm audit fix --force` — it upgrades Next.js
   across a major version and breaks the build.
6. **Add tests.** The verification above was manual and is not repeatable.

---

## 8. Commit history

| | |
|---|---|
| `3116092` | Initial commit: schema, partner/commission module, core CRM |
| `5a06dad` | Project delivery, timesheets and resource utilisation |
| `06e5054` | Detail pages for products, campaigns, quotes, contracts, invoices |
| `0a917a1` | Quote builder, billing runs and cash application |
| `0ab75e6` | User administration with roles and partner portal logins |
| `6328a23` | Refusal instead of a 500 on every permission-gated page |
| `e0c29b1` | Refusal returned from server actions instead of thrown |
| `4ebff12` | The partner portal |
| `42f2a85` | Partner deal registration |
| `b0aad44` | Registration protection windows and review notifications |
| `9be1d36` | Tier-based deal registration protection |
