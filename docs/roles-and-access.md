# Roles and access

How access is decided in this system, and the rules to follow when changing it.

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
approve their own claim regardless of role, including Administrator with `["*"]`.
Prefer that pattern — a rule in the action is stronger than a rule in a role.

## Current roles

| Role | Scope | Holds |
| --- | --- | --- |
| Administrator | ALL | `*` — everything |
| Finance | DEPARTMENT | invoices, payments, commission + payout approval |
| Sales Manager | TEAM | leads, accounts, opportunities, quotations, contracts, partners |
| Sales Executive | OWN | leads, accounts, opportunities (read partners/commission) |
| Project Manager | TEAM | projects, cases, time approval, expense claims |
| Consultant | OWN | projects, cases, expense claims |

Administrator is the founder role. A single all-powerful role is correct there,
and the separation that matters is enforced per action rather than by withholding
permissions.

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

1. Start from the smallest existing role that resembles the job.
2. Add only the permissions the job cannot be done without.
3. Default `dataScope` to `OWN`. Justify anything wider in the migration comment.
4. Never grant `ALL` to make something work — find the missing permission or the
   missing `team_member` row instead.
