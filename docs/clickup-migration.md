# ClickUp → CRM migration

Migrated 2026-08-18 from the "Babul Tech's Workspace" ClickUp workspace
(`90182539953`). This documents what came across, what did not, and why.

Re-run with `node scripts/migrate-clickup.mjs --yes`. It wipes before it writes,
so it is safe to run repeatedly and always reproduces the same result from
`scripts/clickup-export.json`.

## What was in ClickUp

204 tasks across four spaces. The important finding is that **the CRM-shaped
lists were all empty** — the workspace was used for product delivery, not sales.

| ClickUp location | Tasks |
| --- | --- |
| Professional Services / Products | 112 |
| Professional Services / Projects | 18 |
| Marketing / Website | 19 |
| Finance / Expenses | 13 |
| Professional Services / TEMPLATE | 18 (scaffolding, skipped) |

Empty lists: Sales/Accounts, Sales/Contacts, Sales/Opportunities,
Marketing/Prospects, Marketing/Campaigns, Marketing/Partners, Finance/Revenue,
Professional Services/Resources.

## What migrated

**11 projects, 173 tasks.** Each product or project list became one `project`;
its tasks became `project_task`. Completion percent is derived from the share of
tasks in a closed or done status.

| Project | Tasks | Complete |
| --- | --- | --- |
| SmartPOS | 69 | 0% |
| Review Your Doctor | 21 | 0% |
| Jancho | 20 | 80% |
| BabulTech Website | 18 | 89% |
| Babultech Public Site | 17 | 94% |
| SmartEMS | 9 | 0% |
| Muhasba | 9 | 89% |
| SehatNama | 6 | 0% |
| On Demand Portal (ODP) | 2 | 50% |
| CustomerPortal (SF Support) | 1 | 0% |
| Dukaan.pk | 1 | 0% |

69 of these are subtasks, with their parent links preserved. 51 carry an
assignee resolved to a real user.

**13 expenses, PKR 30,250 total.** All from Finance / 2026 Expenses, all dated
April 2026, all paid by Hassan Shamsi — office setup costs (carpet, bulbs,
extension board, internet, transportation).

**7 users**, rebuilt from the five ClickUp workspace members plus Akbar Ali (who
is assigned tasks but is not a member) and Hassan Shamsi (who pays the
expenses).

## What did not migrate, and why

Nothing was lost — these tables are empty because **ClickUp had no data for
them**, not because the migration dropped anything:

`account` (beyond one internal row), `contact`, `lead`, `opportunity`,
`quotation`, `invoice`, `payment`, `partner`, `product`, `support_case`,
`campaign`, `contract`, `commission_*`.

The sales pipeline is genuinely empty. Those modules will render as empty
states until real sales data exists.

## Decisions worth knowing about

**One internal account owns every project.** `project.accountId` is `NOT NULL`
and these are BabulTech's own products, not customer engagements, so a single
`BabulTech (Internal)` account (`ACC-0001`) holds them all. When real customer
work arrives, repoint those projects at the real account.

**Logins changed.** The old `@babultech.com` demo accounts are gone. Sign in
with the ClickUp member's own email and the password `BabulTech@2026` — change
it on first login. Admin is `babul.tech786@gmail.com`.

Supabase Auth verifies the password and issues the session. `app_user` is
consulted only to reject accounts whose `status` is not `ACTIVE` or that are
soft-deleted, which Supabase Auth knows nothing about.

**Two names for one person.** ClickUp spells the expense payer "Hassan Shamsi"
under *Expense By* and "Hasan Shamsi" under *Who Paid*. Both resolve to a single
`Hassan Shamsi` user, matching the spelling the previous admin profile used.

**Expense categories are approximate.** The CRM's six categories are narrower
than ClickUp's expense types. Utilities, Hardware and Internet all fold into
*Office & Supplies*; Transportation becomes *Travel*.

**Two expenses have no amount.** "Claude Subscription On ShiftDeploy account"
and "Office Soap" were never given one in ClickUp. `expense.amount` is
`NOT NULL`, so they loaded as `0.00` in `DRAFT` status — find them by filtering
for draft expenses and fill in the real figures.

**Everything is non-billable.** Internal product work, so `project.billingType`
is `FIXED` with no contract value and every task has `billable = false`.

**Team membership was reconstructed.** ClickUp has no team concept matching the
CRM's, so the five people doing product work were placed on the delivery team.
This drives TEAM-scope visibility; Shabbir and Hassan sit outside it.

## Rollback

`scripts/backup-before-clickup.mjs` captured every table plus `auth.users` to
`backups/<timestamp>/` before the wipe. That directory is gitignored — it holds
real emails and credential hashes. Restoring means replaying those JSON files in
foreign-key order; there is no automated restore script.
