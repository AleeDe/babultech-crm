# Roles and access

How access is decided in this system, and the rules to follow when changing it.

## 4 October 2026: administrators' expense claims

An administrator's claims are approved without a second person: on entry
(the form and imports), on submitting a draft, or by approving one already
waiting. Other people's claims, and a Manager's own, are unchanged.

## 4 October 2026: correcting processed records

Before a record is processed, the usual permissions decide who edits and
deletes it. Once processed, only an administrator may, and an edit needs a
correction opened first (`server/corrections.ts`, `lib/corrections.ts`,
`20261004000002`):

| Record | Processed when |
| --- | --- |
| Lead | converted |
| Deal | won or lost |
| Quote | sent, accepted, rejected or expired |
| Contract | active, expired, terminated or renewed |
| Case | closed or cancelled (resolved can still be reopened) |
| Project | completed or cancelled |
| Campaign | completed |
| Invoice | issued |
| Expense claim | approved or paid |
| Supplier bill | past draft |
| Payment | cleared |

An administrator presses **Correct** on the record (or on its edit page) and
says what was wrong. That opens the record for 30 minutes; the reason, who
opened it and when are kept in `record_correction`, every field change in
`audit_history`, and the owner is notified (`RECORD_CORRECTED`). Every edit
action calls `editGate()` before saving, and `deleteToRecycleBin` calls
`deleteGate()`, so a non-administrator is refused on the server whatever the
page shows.

Guardrails that hold for administrators too: a closed month stays closed
(reopen it first), and an issued invoice or a sent quote is corrected in its
wording, dates and references only (`correctDocumentWording`); its amounts and
lines change through a credit note or a new version. A supplier bill with
payments against it keeps its total, and a payment allocated to invoices keeps
its amount. Approved time is still corrected by the approver rejecting it back.

## 4 October 2026: deleting from list rows

Every list has a Delete link beside Edit on each row, and more kinds of record
go to the recycle bin (`20261004000001`). Who may delete each kind:

| Kind | Permission |
| --- | --- |
| Leads, campaign members, activities | `lead:delete` |
| Accounts, contacts | `account:delete` |
| Deals, quotes | `opportunity:delete` |
| Cases, help articles | `case:delete` |
| Campaigns | `campaign:delete` |
| Contracts | `contract:delete` |
| Projects | `project:manage` |
| Invoices (drafts only) | `invoice:write` |
| Supplier bills (drafts only) | `payable:approve` |
| Payments (unallocated only) | `payment:write` |
| Products and services, price books, partners, expense claims | administrators |

Money stays intact: an issued invoice is voided or credited, never deleted; a
supplier bill only while a draft; a payment only while nothing is allocated
from it; nothing in a closed month. An administrator may delete any expense
claim, approved or paid included, unless its month is closed; everyone else
keeps the earlier rule (their own, before approval). Users are never deleted,
only switched off. `recycle_blocker()` gives the reason for every refusal.

## 29 September 2026: View as, and deleting records

**View as** (`user:view_as`) opens the CRM or a portal as another person sees
it: their permissions, their data scope, their records. It needs a reason,
ends after 30 minutes, never works on an administrator or someone inactive,
and cannot be started from inside another view. It is read-only twice over:
the app refuses every server action while a view is open, and the database
refuses any insert, update or delete made on the view's token, on every table
(`20260929000002`; `scripts/check-view-as-guard.sql` lists any table that lacks
the guard). Start, end and reason are in Users › Security history. Only people
who can open the Users screen can use it, so in practice it is administrators'.

**Delete permissions** - `lead:delete`, `account:delete` (accounts and contacts),
`opportunity:delete`, `case:delete` and `campaign:delete` - move a record the
person can see to the recycle bin and restore it. Erasing for good is
`admin:*` only. A role holding `lead:*` and the like already has these: today
that is the Manager role and Super Admin. Finance records, expenses and users
cannot be deleted this way.

**Notifications and follows** are each person's own: row security returns only
your notifications, preferences, follows, saved views and recent records.
Following a record needs you to be able to see it, so nobody is told the name
of a record they could not open.

## 28 September 2026: partners' records, and partners as sellers

Two rules were added, both enforced in the database by
`20260928000004` to `20260928000008`.

**A partner's records are every salesperson's.** Visibility normally follows a
record's owner and the reader's data scope. A record credited to a partner is
the exception: anyone whose role may read that kind of record reads it, and
anyone who may write it works on it, whoever owns it and whatever their scope.
A record is a partner's when it is credited to one: a lead's
`referredByPartnerId`, an account's or a deal's `sourcePartnerId`, or a contact
on such an account (or with its own `sourcePartnerId`). Quotes, activities and
a deal's products and services follow the record they belong to. Commission,
invoices and payments are not widened.

Row-level security applies the rule through `app_sees_partner_records()` and
`app_works_partner_records()`; the app's owner-scoped lists apply the same rule
through `applyScopeWithPartners()` in `lib/db.ts`, so a list never narrows
below what the database allows. `save_opportunity_lines` and `accept_quotation`
check the same way.

**Partners work their own records from the portal.** A partner login reads only
its own partner's records, and writes only through the `partner_*` SECURITY
DEFINER functions, each of which checks the record is the partner's first:

- leads: create, import, edit, email, log activities, convert;
- accounts and contacts: create and edit;
- deals: details, stages, and closing - won only on an accepted quote;
- a deal's products and services, and quotations;
- their company's own Products & Services. They see BabulTech's read-only and
  never another partner's. Price books are read-only.

Owner and campaign stay ours. A partner approves nothing: a quote a partner
prepares is approved by somebody with `quotation:approve` before it can be sent
- the `quotation_partner_quote_approved` constraint enforces that whatever path
is taken - and once the customer accepts a quote, the partner can no longer
change the deal's lines, so the amount commission is paid on is one we approved
and the customer accepted.

## 18 September 2026 application update

Project administration server actions and create/edit screens now require
`project:manage`. Administrator (`*`) and Project Manager (`project:*`) already
hold it. Consultant's legacy `project:write` does not grant this capability.
Contributors continue to update their own assigned tasks through My Work or
the task detail page; assignment ownership is checked separately. Custom roles
that administer projects need an explicitly reviewed `project:manage` grant.

Assignment pickers return only active staff identity. Migrations
`20260918000002` and `20260918000003` now enforce project assignment/management
boundaries in PostgreSQL, restrict own-task progress fields, protect user/team
administration, and revoke direct SELECT of member/time rate columns.
Financial reads require `project:rates` and recheck record visibility before
privileged enrichment; invoice-only readers get billing rates without costs.
Database triggers own time-rate snapshots and prevent self-approval/tampering.
Current PM `project:*` includes rate authority; narrower roles can separate it.

The historical deployment observations below are not a current audit. Run
`npm run access:audit` for staffing findings and see the agency plan for rollout
status. No persistent user role, reporting or team assignment was changed.

## One role per user

`app_user.roleId` is a single NOT NULL column. A user has exactly one role, and
that is deliberate — do not add a join table for multiple roles.

A role carries two different things:

| Field | Governs | Combines safely? |
| --- | --- | --- |
| `permissions[]` | *What* you may do (`invoice:approve`) | Yes — a union is still coherent |
| `dataScope` | *Whose* records you see (`OWN`/`TEAM`/`DEPARTMENT`/`ALL`) | **No** |

Data scope is why multiple roles are a bad idea. If someone held both Sales
Executive (`OWN`) and Finance (`DEPARTMENT`), the system would have to pick a
rule, and in practice that rule is always "widest wins". The moment it is, any
role carrying `ALL` silently grants global visibility through every other hat
that person wears. That failure is invisible until someone reads a record they
should never have seen.

When someone genuinely does two jobs, create **one role that describes that
job** ("Finance & Delivery Lead"). Roles are one row in `security_role`. An
explicit combined role can be read and audited; a runtime union cannot.

## Least privilege

A role gets a permission because the job cannot be done without it, not because
it seems convenient. Two rules follow from that:

**`ALL` scope is exceptional.** Only Administrator holds it. Everything else is
`TEAM` (with real `team_member` rows) or `OWN`. `ALL` means every row in every
table the role can read — every deal, every case, every customer conversation.

**Separation of duties beats role design.** The person who creates an obligation
must not be the one who approves it. Where that cannot be expressed as a
permission, it is enforced per action: `setExpenseApproval` refuses to let anyone
approve their own claim. Since 4 October 2026 the one exception is an
administrator: their expense claims need nobody's approval (see above).
Everyone else still needs a second person.
Prefer that pattern — a rule in the action is stronger than a rule in a role.

## Current roles

Since `20260920000006_five_roles.sql`. Only a Super Admin creates roles or
changes what a role may do.

| Role | Scope | Holds |
| --- | --- | --- |
| Super Admin | ALL | `*` — everything |
| Manager | TEAM | leads, accounts, deals, contracts, cases, projects, and the approvals that go with them: quotations, commission, time, invoices, payables, expenses |
| Consultant | OWN | projects, cases, expense claims |
| Partner | OWN | external — the partner portal only; what a partner reaches comes from their partner link, not from permissions |
| Customer | OWN | external — the support portal only |

Super Admin is the founder role. A single all-powerful role is correct there,
and the separation that matters is enforced per action rather than by withholding
permissions.

The next section describes the roles this replaced, and is kept as history.

## What was tightened, and why

Applied in `20260818000002_least_privilege_roles.sql`.

**Finance: `ALL` → `DEPARTMENT`.** Finance could read every row in the system —
every lead, deal, project and support case. Its permissions already prevented
*acting* outside invoices and payments, but scope governs what is *visible*, and
reading every customer conversation is not part of paying bills. The finance
module itself is unaffected: invoices, payments and expenses filter on their own
ownership rules rather than a generic `ownerUserId`, so Finance still sees the
whole ledger.

**Sales Manager: lost `commission:approve` and `payout:approve`.** The manager
who booked the deal was also approving the commission earned on it and releasing
the payout — one person creating, approving and paying an obligation with no
second pair of eyes. Approval moved to Finance. Sales Manager keeps
`commission:read` and `commission:write`, so they can still see and adjust what
their team is owed.

**Consultant: lost `account:read`.** The account list is the full customer book
including revenue and credit terms. A consultant's work is projects and cases,
which carry the customer name they actually need.

## The four scopes

| Scope | Sees | Use for |
| --- | --- | --- |
| `OWN` | Only their own records | Individual contributors |
| `TEAM` | Everyone sharing a `team_member` row with them | Peers who collaborate |
| `DEPARTMENT` | **Themselves and everyone beneath them in the reporting line** | Managers and department heads |
| `ALL` | Everything | Administrator only |

`DEPARTMENT` is hierarchical, not a flat roster. It walks `app_user.managerUserId`
downward: a manager sees themselves, their direct reports, and everyone beneath
those, however deep. Authority flows **down** the org chart only —

- nobody sees their own manager
- two people reporting to the same manager cannot see each other
- someone with no reports sees only themselves

That is what makes it safe to give a department head a wide scope: it is wide
over *their* branch and stops at its edge. Set it on the user form under
**Reports to**; the walk is cycle-safe, so a bad edit cannot hang a query.

## How scope is actually enforced

In two places, and both matter:

1. **`scopeFilter()` in `lib/authz.ts`** builds a `where` clause for list
   queries from the caller's `dataScope`.
2. **Row-level security** in `supabase/functions-sql/003_policies_rollout.sql`
   and `20260816000000_policies_remaining.sql` enforces the same thing in the
   database, so a query that forgets the filter still cannot over-read.

A partner's records are the exception to both: every salesperson sees and
works them whatever their scope (see 28 September 2026 above).

Some tables scope through a related record rather than their own owner.
`project`, `invoice`, `payment`, `contact`, `support_case` and `contract` are
visible when the caller can see the row's **account** (`app_visible_account_ids()`).

### Known consequence: OWN-scope users see no projects

Because `project` scopes through its account, a consultant sees a project only if
they can see the account it belongs to — and an `OWN`-scope user sees only
accounts they own. Consultants own no accounts, so `/projects` is empty for them
even though they hold `project:read`.

This is pre-existing RLS behaviour, not a permission bug, and it is worth fixing
deliberately. Three options, in order of preference:

1. **Populate `project_member`** and add a policy making a project visible to its
   members. This is the correct fix and matches how people actually work.
2. Give Consultant `TEAM` scope and put the delivery team in `team_member`.
   Widens what they see to the whole team's accounts.
3. Assign consultants as `projectManagerId` on their projects. Only works for
   one person per project.

All 11 projects currently have one manager and no `project_member` rows, both
inherited from the ClickUp import — ClickUp had no team structure to bring over.
Until one of the above is done, project visibility is effectively
Administrator-and-Project-Manager only.

## Adding a role

Sales handoff workflow (18 September 2026): submitters need `lead:read` and `lead:write` and must own the open lead. Recipients must be active internal users in an active role with those permissions plus `opportunity:write`. Role names are not used for eligibility. Only sender/recipient can read the handoff snapshot, subject to active internal lead-read access. The designated recipient accepts/rejects; the sender cancels. Acceptance transfers lead ownership atomically and requires a future follow-up. Pending handoffs block direct status/ownership/conversion changes. Handoff rows have no authenticated direct mutation grants; checked RPCs perform writes. No existing staff role or team assignments were changed for this rollout.

1. Start from the smallest existing role that resembles the job.
2. Add only the permissions the job cannot be done without.
3. Default `dataScope` to `OWN`. Justify anything wider in the migration comment.
4. Never grant `ALL` to make something work — find the missing permission or the
   missing `team_member` row instead.
