# Fresh user and capacity browser review — 19 September 2026

## Database reporting guard follow-up

Migration `20260919000003_reporting_graph_guard.sql` is applied. It adds a
statement-level mutex row update before staff writes and a row-level ancestry
check on manager changes. Sequential/multi-row cycles, self-reporting and new
assignments to inactive/external managers are rejected. Unchanged reporting
lines do not block unrelated profile edits. Existing staff mappings are not
rewritten.

Rollback checks passed before apply and inside the apply savepoint. Real
concurrent requests passed under READ COMMITTED and REPEATABLE READ: only one
of two mutually cyclic assignments committed, with the other rejected for a
cycle or serialization failure. Both temporary staff identities and their role
were removed. Reproduce using `scripts/test-reporting-concurrency.mjs` with a
management token supplied via environment or stdin, never stored in the repo.

All app_user writes now serialize through one short transaction lock. Keep
staff-management transactions short; stale transactions may need a retry.
This supersedes the earlier note below that a database guard was pending.

## Follow-up: team onboarding and assignment validation

Internal user creation now continues to `/users/[id]/teams`; existing profiles
have a Manage teams link. Administrators can create typed teams and add/remove
membership. Add requires an active internal user and an active team. Repeated
assignment uses a deterministic membership ID so retries do not add duplicate
rows. Removal deletes that user's membership in that team; department and
project membership do not change. Partner creation returns to the user profile.

Create/update validates active roles and departments, an active internal direct
manager, and rejects self-reporting and cycles found while traversing the current
reporting line. Partner records must exist and partner submissions cannot carry
internal staffing/rates. These are server-action validations; no new database
constraint was added. Concurrent hierarchy edits or other privileged database
writers still need a transactional database guard in a later hardening slice.

The team UI and server actions require administration. Existing staff were not
reassigned and no agency role grants were invented. Dedicated SDR/editor and
marketing permission mapping remains pending. Team rename/archive, audited
membership history and effective-date scheduling are not included in this slice.

Local regression suite: 623 tests passed. The updated browser pilot passed 12 checks and verified
team creation, assignment and removal in addition to the original user/capacity
checks, with temporary fixture cleanup. The earlier gaps below describe the
initial review; team UI and sequential reporting validation are now addressed.

Standalone Playwright Chromium against localhost:3100 and the configured
Supabase passed nine checks. In-app browser bootstrap still reports a missing
sandboxPolicy field; the standalone browser works. The previous server-start
approval blocker did not recur on this run.

## Verified

Administrator login; creating a user through the actual form; persisted role,
department, reporting manager, job title and notification address; editing and
clearing the notification override; signing in as the newly created user;
contributor denial on user administration and capacity; overdue work and daily
overload rendering; period filtering; mobile layout on both screens.

No browser runtime errors. Temporary identities, roles, department, project and
task were removed successfully. Script: `scripts/test-users-capacity-browser.mjs`.
Report and screenshots: `artifacts/browser-qa/users-capacity-report.json`,
`user-create-desktop.png`, `user-create-mobile.png`, `capacity-mobile.png`.

## Fixed from the review

- User creation failed with `permission denied for table app_user`: generic
  writes attempted a full-row read blocked by protected rate columns. The
  explicitly ADMIN-authorized server path now inserts through the service
  client and selects only the ID. Update retains its atomic audit RPC through
  the server service client, with fixed table and authenticated actor ID.
- Notification email was displayed but omitted from the form payload.
- Department scope text wrongly described department membership instead of the
  reporting subtree. Corrected user form/detail and Settings guidance.
- Rates guidance wrongly implied missing rates meant zero utilisation.

## User setup gaps

Role means permissions and scope; department is an organizational label; Reports
to determines reporting-subtree visibility. Team membership is separate and is
not assigned by the user-create form. Project assignments are separate too.

The current real role cards are Administrator, Consultant, Finance, Partner,
Project Manager, Sales Executive and Sales Manager. Job titles such as writer
or developer do not require separate roles unless their permissions differ.
SDR/research, marketing, editorial review, publishing and customer-success
capabilities still need deliberate mapping to actual responsibilities.

No team management/assignment UI was found in Settings or user creation.
The update action checks self-manager but does not reject longer reporting
cycles. Legacy hierarchy traversal is cycle-safe; that does not make a cycle a
valid reporting structure. Active role/manager/department validation also needs
hardening at the write boundary. This browser run did not prove those edge cases.

## Remaining roadmap modules

- Leave/working calendars and dated resource allocations.
- Service project templates, specialist QA and handover evidence.
- Retainer deliverable allowances, revision limits and scope changes.
- Brand library and separate client advertising spend/service fee tracking.
- Financial thresholds and second-person payout authorization; reconciliation.
- Dedicated customer-success ownership and staff rollout.
- Subscription proration/upgrades and automated integrations where agreed.

Existing content, sales handoffs, subscriptions and client review links remain
implemented; this run covers user onboarding and capacity, not every CRM module.
