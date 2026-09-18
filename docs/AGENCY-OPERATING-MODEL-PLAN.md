# Agency operating model and CRM roadmap

Review date: 18 September 2026. Status: proposal for discussion; no application, role, or database changes authorized by this document.

Implementation started after the user's subsequent approval. The first package adds a repeatable read-only access audit, removes employee rates from project assignment pickers, and requires `project:manage` for project administration server actions and create/edit screens. Existing Administrator (`*`) and Project Manager (`project:*`) grants satisfy the new capability; the existing Consultant `project:write` grant does not. Contributors retain their separately checked own-task progress flow. Custom roles needing administration must be reviewed for an explicit `project:manage` grant.

The second package applied migrations `20260918000002` and `20260918000003`: project and child RLS follows active assignment or authorized management scope; task contributors can only change their own progress; project notes/documents inherit access; user/role/team mutation requires administration; the privileged project-creation RPC checks authority itself. Time submission/approval and immutable database-generated rate snapshots are enforced in PostgreSQL. Member/time rate columns are no longer readable through normal authenticated database queries. Financial enrichment requires `project:rates` and rechecks visible record IDs; invoice-only readers receive billing rates without employee costs. Current PM `project:*` and Administrator `*` include rate authority; narrower future roles can separate it.

Phase 1 still requires actual staff/reporting mapping and a staff pilot across the broader application. No persistent user roles, reporting assignments, or memberships were changed. This is targeted hardening, not a claim that every unrelated CRM module/RPC or historical signed URL has been audited.

Database verification ran inside rollback transactions and, during apply, a savepoint rolled back all synthetic fixtures and test-only user changes before committing the schema. Checks cover member/nonmember reads, notes/files, own versus colleague task progress, direct generic RPC tampering, self-enrollment, user escalation, self-approval, manager approval, revocation, inactive users, denied rate/wildcard reads, rate injection, and safe generic create responses. Recovery policy/function snapshots were saved in the OS temporary directory; no token was written to the repository. Local regression suite: 49 targeted tests; production build and TypeScript checks passed.

Validation: targeted authorization, directory projection, baseline analysis and own-task progress tests; TypeScript check. `npm run access:audit` performs only reads, prints counts by default, and accepts `-- --details` for record IDs needing review. The live baseline reviewed on 18 September showed six active users with blank job titles/reporting managers, one reporting-scoped user with no reports, and one inactive team membership. These observations require business mapping, not automatic reassignment.

Phase 2 first slice is implemented at `/leads/calling`, linked from Leads: a personal, paginated queue with horizontal due/overdue, later-today, needs-scheduling, upcoming and all-open filters. Times explicitly use Pakistan time. Recording a completed call requires a standard outcome, notes and a future follow-up; it atomically updates the existing lead and activity ledger without changing lifecycle status. A stable request UUID prevents duplicate saves on retry. Migration `20260918000004` is applied. PostgreSQL rollback checks passed for ownership, permission denial, idempotency, conflicting retries, past follow-ups, closed leads and atomicity; nine local tests, TypeScript and the production build passed. Browser/staff pilot remains pending. Qualification, accepted sales handoff, research quality queue and quote-to-kickoff checks are still outstanding; this does not complete Phase 2.

To pilot: open Leads → My calling queue → Needs scheduling / All open; choose an assigned open lead, record the completed call and next action, and verify its new follow-up in the queue and call entry in Activities. For a wrong number, schedule contact verification. This workflow records manual calls; it does not dial, send outreach or provide channel suppression automation.

Phase 2 second slice adds qualification and explicit sales handoff acceptance. An assigned open lead's owner records service interest, need, authority, budget understanding, timing and next action; unknown details are permitted explicitly. Submission marks the lead Qualified while retaining its owner. `/leads/handoffs` shows participant-only qualification snapshots. Only the designated active salesperson can accept/reject, with a reason; acceptance requires a future follow-up and atomically transfers ownership. The sender can cancel. Pending handoffs block status, ownership, conversion and soft-deletion changes at the database boundary. Accepted handoffs use the existing separate lead-conversion flow, so handoff acceptance itself creates no account, contact or opportunity. Existing direct qualification/conversion for leads without pending handoffs remains available; this is not a mandatory universal SDR gate.

Migration `20260918000005` is applied. Synthetic OWN-scope caller, salesperson and unrelated salesperson checks passed for snapshot isolation, ownership transfer, rejection/cancellation, duplicate requests/decisions, inactive access, incomplete qualification and direct/generic-RPC tampering. All fixtures were rolled back; postflight found zero test users/leads and no authenticated direct INSERT/UPDATE privilege on handoffs. Local calling/handoff suite: 23 tests; production build/type checks passed. Browser and actual staff pilot remain pending. Actual role assignments were not changed. Research quality and quote-to-kickoff gates remain outstanding.

Pilot the handoff: open an assigned lead → Qualification & sales handoff → choose a salesperson → submit. The recipient opens Leads → Sales handoffs, reviews the brief and accepts with a dated next action or returns it with a reason. After acceptance, open the lead → Convert lead to reuse/create the customer and optionally create the deal. The recipient picker requires active internal staff with `lead:read`, `lead:write`, and `opportunity:write` (including matching wildcard grants). No email/dialer notification is sent by this workflow; recipients check the handoff page.

Phase 2 research review slice is implemented at `/leads/research`, linked from Leads → Research quality. It derives a review queue from visible open, nondeleted/unconverted leads: missing or malformed contact details, possible matching email/phone/WhatsApp, missing source/campaign/referral, missing Description research context, and missing follow-up. Horizontal filters and 40-row pages lead back to the existing edit form. Source records are not automatically merged, reassigned or changed; shared contact details require human review. Matching ignores email case and phone formatting but does not infer country codes or resolve extensions. Only scanned open leads are compared, not historical converted leads, accounts or contacts.

The server uses the caller's Supabase client, existing RLS and explicit owner-scope filtering. It reads in 500-row batches with a 5,000-record ceiling and displays incomplete-scan warnings and scanned/total counts. This is an interactive review tool, not a comprehensive duplicate audit at larger volumes. Twelve analyzer/access/pagination tests passed. No database migration or staff/data mutation is required. Actual browser/staff review remains pending. Structured research approval, duplicate merge/resolution history and quote-to-kickoff gates remain future work.

Phase 2 delivery readiness slice is implemented at `/projects/handoffs`. From an owned CLOSED_WON opportunity, Sales chooses an existing linked DRAFT/PLANNING project and accepted quotation, then records customer/owner contact, signed-scope reference, deliverables/plans, exclusions, dates/dependencies, billing schedule, payment evidence, acceptance criteria, revision allowance and promises/risks. The assigned active PM accepts with a future kickoff date and readiness/capacity notes or returns it with a reason; the sender can cancel. Corrected submissions keep prior review history. No duplicate project, invoice, payment or commission is created.

Payment prerequisite is a manual `PENDING` / `VERIFIED` / `NOT_REQUIRED` declaration with required evidence or explanation, not automatic reconciliation with the payment ledger. PENDING blocks acceptance. Acceptance records readiness but does not activate the project. For projects enrolled by a handoff, activation/resumption requires the latest handoff to be accepted, the same PM/account/opportunity, a still-won deal and an unchanged accepted quotation. A fingerprint includes both the quotation and its line items. This is a project-status gate, not a blanket lock on every task/time action or a substitute for later scope-change approval. Projects without handoffs retain their existing workflow.

Migration `20260918000006` is applied. Synthetic OWN-scope Sales/PM checks passed for participant isolation, incomplete briefs, payment gating, PM authority, return/resubmission, stable retries, direct/generic-RPC tampering, activation, quotation/line changes and inactive PM access; all fixtures rolled back. Eighteen local validation/action tests and production build/type checks passed. Browser/staff pilot remains pending. No staff roles were reassigned. These slices do not yet establish full Phase 2 pilot acceptance or automated finance verification.

Pilot: PM creates a planning customer project linked to the won opportunity and the same account. Sales opens that opportunity → Delivery handoff → completes the checklist. PM opens Projects → Delivery handoffs → reviews/accepts or returns. After acceptance, PM opens the project and activates it through the existing project edit flow. If commercial terms change, put the project into planning and submit a fresh review before activation.

Phase 3 first slice: each project now links to `/projects/[id]/content`, a month-filtered editorial planning agenda in Pakistan time. Planning metadata attaches one-to-one to an existing project task, preserving its assignment, due date and progress. The PM records standard channel/format, objective, audience, brand/reference brief, planned publish time and whether client approval will be required. Members with project read access see plans; authorized project managers edit plans on open tasks. Calendar rows are paginated; the task picker explicitly caps its list at 500 open tasks. Completed/cancelled tasks retain their plan but cannot be replanned without reopening through the task workflow.

Migration `20260918000007` is applied. Database checks passed for manager writes, member reads, membership revocation, direct-write denial, invalid channels, completed-task edits and optimistic revision conflicts; verification fixtures and test membership changes were rolled back. Four date/validation tests, TypeScript and production build passed. Planning revisions are concurrency counters, not approved content versions or a version history. No caption/media approval, publishing automation or publication evidence is implied by a calendar date or a completed task. Browser/staff pilot remains pending. The next content slice is versioned copy/assets with approval tied to an exact version.

Pilot: create and assign a content task in the project workspace → Content calendar → Plan an existing content task. Set the brief and planned date, then use that month to edit the plan. The task link opens the existing task workspace for progress and assignment context. Client approval is a declared future requirement here; it is not recorded as granted.

Phase 3 version/review/publication slice is implemented at `/projects/[id]/content/[taskId]`, linked from each calendar item. Assigned contributors and authorized project managers save immutable caption/script versions with an optional external asset URL plus SHA-256. Every version snapshots its planning brief and client-approval requirement. The exact copy/reference/hash is stored; external file bytes are not uploaded, downloaded, frozen or cryptographically verified by the CRM. Reviewers must manually verify a frozen file version against the recorded hash. An external URL alone does not guarantee immutable media.

Independent project managers review the current version; authors cannot review their own version, including manager-authored work. A review records either approval or changes requested and evidence. Client review is available after internal approval when required, with a named client approver and received-decision evidence; this is internal staff recording, not an authenticated client signature. A requested change requires a new version; prior decisions are not overwritten. A changed content plan also requires a fresh version and approvals. Review authority currently uses the existing scoped `project:manage` capability; a narrower editor-only capability and actual staff mapping remain future work.

The assigned contributor or project manager can record one manual publication entry per approved version with a live HTTP(S) URL and actual publication time, no earlier than the required recorded approvals and no later than now. The action does not publish to a channel, fetch the live URL, validate external content, or complete the task. Historical published evidence remains attached to its exact version even when later versions are created. The history is paginated at 20 versions.

Migration `20260918000008` is applied. Rollback checks passed for immutable rows, duplicate retries, optimistic conflicts, internal/client approval ordering, no author self-review, publication approval/time gates, reapproval on copy/brief changes, unassigned-member writes and revoked-member reads of versions/reviews/publications. All fixtures and test-only membership changes were rolled back. Seventeen content tests, TypeScript and production build passed; an anonymous PostgREST relationship smoke check recognized the embeds and denied reads. Browser/staff pilot remains pending.

Pilot: project → Content calendar → Versions, approvals & publication → save the exact copy and optional asset version/hash. A different authorized PM records internal review, then received client approval where required. After actual manual publication, record its live URL/time. Submit a new version after requested changes; never overwrite approved copy or reuse an old approval for changed assets.

Follow-up verification: the content suite now has 23 passing tests, including PostgREST's single-object publication embed, absent publications, author/reviewer relation normalization, project/task mismatch rejection, older-page latest-version handling and history-fetch failure. The in-app browser pilot was attempted but could not initialize: its execution tool rejected the environment metadata with a missing `sandboxPolicy` field. No browser session or UI interaction was established; browser/staff acceptance remains unverified. This is a tooling blocker, not evidence of an application failure.

Browser pilot completed on 18 September 2026 against the local application and the linked Supabase project, using headless Chromium and temporary synthetic identities created and deleted by the scripts themselves. Both runs finished with zero uncaught browser runtime errors, and each script's postflight confirmed its fixture project/lead count back at zero.

`scripts/test-content-browser.mjs` covers the Phase 3 content workflow: ten checks passed for manager and writer UI sign-in, plan creation through the calendar, a writer version with planning/self-review/publication controls correctly hidden, independent internal review, the client-approval gate holding publication closed until evidence is recorded, synthetic publication evidence rendering its embed without crashing, a second version not inheriting the earlier approval while its published history stays attached, a 390px viewport with no horizontal overflow, and a revoked member losing version-page access.

`scripts/test-leads-browser.mjs` covers the Phase 2 calling and handoff workflow: fifteen checks passed for SDR and salesperson sign-in, the personal calling queue showing only the signed-in owner's lead, a logged call writing the activity ledger and follow-up without changing lifecycle status, qualification submission marking the lead Qualified while ownership stays with the sender, a pending handoff blocking resubmission, the recipient reading the qualification brief and accepting, ownership transferring atomically, the lead moving between the two calling queues, the research quality queue rendering for the new owner, and a 390px viewport with no horizontal overflow.

`scripts/test-delivery-browser.mjs` covers the delivery handoff: seventeen checks passed for sales and PM sign-in, the submission form staying hidden from a PM without `opportunity:write`, a submitted checklist routing to the project's assigned PM, the PM reading the full checklist and returning it with a reason, sales correcting the payment evidence and resubmitting while the earlier review survives as history, acceptance with a future kickoff, and a 390px viewport with no horizontal overflow.

Five of those checks confirm the gates hold in PostgreSQL rather than only in the interface: a `PENDING` payment state refuses acceptance through a direct RPC call, project activation is refused while the current handoff is unaccepted, acceptance records readiness without activating the project, activation succeeds once the handoff is accepted, and changing the accepted quotation's total invalidates the stored fingerprint so activation is refused until a fresh handoff is accepted.

Phase 4 first slice closes two finance gaps found by reading the live policies rather than the code. First, `invoice`, `invoice_line`, `payment` and `payment_allocation` carried write policies declared with `app_can_write()`, which asks only whether the caller is an internal user with any scope at all. `src/server/billing.ts` checked `invoice:write` and `invoice:approve` on every action, but PostgREST is reachable without it, so any internal token could move an invoice from DRAFT to SENT, rewrite `totalAmount`, or record a payment that never arrived. Second, `setExpenseApproval` has refused self-approval since `20260830000000`, but the invoice path never grew the same rule, so whoever raised an invoice could also issue it.

Migration `20260918000009` is applied. Finance writes now require the permission that names them, through `app_can_write_finance()`. Drafting stays with `invoice:write` and only while the invoice is still a draft; issuing, voiding and writing off require `invoice:approve`; recording receipts requires `payment:write`. An invoice may only be inserted in a draft state, lines freeze when their invoice is issued, and an issued invoice cannot be deleted. `preparedById` is stamped by trigger on insert, `issuedById` on issue, and `guard_invoice_issue()` refuses to let the preparer be the issuer. `app_can_write()` itself is untouched: 45 tables lean on it, and this change is about the four that move money.

A null `preparedById` means the preparer is genuinely unknown, which the guard treats as "not provably the same person" and allows; the live database currently holds no invoices at all, so no backfill was required. Postflight confirmed 13 new policies, zero finance write policies still resting on `app_can_write()`, both triggers present and no verification fixtures left behind.

`scripts/test-finance-browser.mjs` covers this with seventeen checks against the running application, using each synthetic identity's own Supabase token so the database is tested directly rather than only the pages: a preparer drafts and is stamped as preparer, a contributor holding no invoice grant cannot raise an invoice, issue an existing one or record a payment, the preparer cannot issue their own invoice, someone holding `invoice:approve` still cannot issue an invoice they prepared, the invoice screen explains why, a second person issues it and is recorded as issuer, the lines of an issued invoice can no longer be edited or deleted, finance can still record a receipt, and the invoice list and detail page still render at desktop and 390px widths.

Phase 4 second slice adds recurring contract billing and accounting period locks, applied as migrations `20260918000010` and `20260918000011`.

Recurring billing raises one draft invoice for each contract period that has already started on an ACTIVE MONTHLY, QUARTERLY or ANNUAL contract, from Invoices → Billing run → Bill contract periods. The period a draft covers is stored on the invoice, and a partial unique index refuses a second live invoice for the same contract period, so the run is safe to repeat and two people clicking at once cannot bill a customer twice. A cancelled or soft-deleted invoice frees its period, which is the point of cancelling a draft. Month arithmetic clamps to the end of a shorter month, so a contract starting on 31 January bills on 28 February and then on 31 March rather than skipping or drifting. The period amount is the contract value divided by the number of periods in the term; the run raises drafts only, and never issues one.

Period locking closes a finished month from Finance → Periods. Closing requires `invoice:approve` and a written reason, and the current month cannot be closed, because closing the month you are still trading in blocks ordinary same-day corrections. A closed month refuses new invoices, payments and expenses, refuses edits to the ones already in it, and refuses moving a record's date out of it; invoice lines follow their invoice's month so a closed invoice cannot be rewritten a line at a time. Reopening also requires `invoice:approve` and a reason, and is recorded on the lock row rather than deleting it, so a month that was closed and reopened stays visible.

Applying `20260918000010` surfaced a real defect in the previous slice: `guard_invoice_issue()` treated any move out of an editable status as issuing, so it also caught DRAFT → CANCELLED and told whoever raised a draft that they could not cancel their own mistake. The `invoice_write_update` policy had the same shape. Migration `20260918000011` narrows both: issuing now means a move into SENT, PARTIALLY_PAID, PAID or OVERDUE, and `invoice:write` may cancel a draft but still cannot reach a billing status. Both were verified by extending the existing finance checks rather than replacing them.

Verification ran in rollback transactions before applying, then against the running application: `scripts/test-periods-browser.mjs` passed nineteen checks, including the run raising one draft per started period, every raised invoice being a draft, the recorded period and amount, a second run billing nothing twice, the database refusing a duplicate period directly, an operator seeing the page but unable to close a month, an approver closing one through the UI, the current month refusing to close, a closed month refusing new invoices and payments while an open month still accepts them, reopening being recorded, and a 390px viewport. 44 unit tests cover the date arithmetic and the actions. Postflight confirmed the index, four period triggers, three functions and the new invoice columns, with no fixtures left behind.

Phase 5 first slice adds a renewal queue and account health, with no migration: every signal already exists in the records, so nothing new is stored and nothing is written.

`/accounts/renewals` lists contracts ending within 30, 60 or 90 days, soonest first, with anything already lapsed ahead of the rest. Each row carries the end date, the notice deadline worked out from the contract's own notice period, the named account manager, the value and whether it auto-renews. An auto-renewing contract still appears: it renews by its own terms, which is not the same as somebody having checked it. An account whose owner has left or been deactivated reads as "Nobody named" rather than showing a former employee's name.

`/accounts/health` derives a GREEN/AMBER/RED reading for each customer account from overdue invoices weighted by how late they are, support cases past their agreed response or resolution time, high and critical cases still open, cases that came back after being closed, recent satisfaction scores, how long since anyone logged contact, and contracts ending or already lapsed. Every signal that counted is shown with its reasoning; a score nobody can explain is worse than no score, because people act on it anyway. Filters cover needs-attention, no account manager, onboarding and stored-health-differs.

The stored `customerHealth` field is deliberately not overwritten. It is somebody's judgement; the derived reading is what the records say. Where they disagree, both are shown so a person can look. Onboarding age is reported from the account's creation date and flagged past 30 days.

Validated by 50 unit tests over the scoring and date arithmetic and 19 browser checks against the running application, including the lapsed contract sorting first, a narrower window keeping what is inside it, an unrecognised window falling back to the default rather than widening it, a deactivated owner reading as nobody named, the stored health surviving untouched, a mild signal alone not dragging an account out of green, each filter, and a user with neither `account:read` nor contract access seeing no data on either page. All fixtures were removed.

Health reflects what has been recorded in the CRM, so an account nobody logs work against looks quiet rather than well. This is a review tool, not a churn prediction, and the weights are a starting point that should be revised once the team has used it. Named-manager assignment still uses the existing `ownerUserId`; a separate customer-success owner distinct from the sales owner, renewal ownership workflow, and the controlled client collaboration described below remain future work. Recurring product subscriptions do not yet produce renewal dates of their own - only contracts do.

Reconciliation against bank records, approval thresholds, second-person authorization for payouts, and the split between a finance operator and an authorized payer remain proposals. `invoice:approve` still covers issuing, voiding, writing off and period closing as one capability. Recurring billing covers contracts only; a product's monthly pricing plan does not yet generate invoices on its own, and nothing runs on a schedule - the run is started by a person.

This is automated interface verification with synthetic data, not a staff pilot. It does not exercise real customer records, production data volumes, or acceptance by the people who will use these workflows. The staff pilot remains outstanding.

## 1. Decision and evidence

Keep the existing CRM, delivery, and finance foundation. First repair access boundaries and staff assignments; then connect acquisition, delivery, content production, retention, and billing through explicit handoffs. Do not build a second account database or replace working modules.

This plan combines repository inspection, the preceding read-only role/database review in this session, and official platform documentation. It is not a penetration test, a certification, or proof that every deployed workflow works. A route or schema establishes a foundation, not production readiness. Deployment/migration history and role scenarios must be rechecked before implementation.

The operating model below is a proposal for this agency, not a claim that every large company uses the same organization chart. Functional responsibilities do not imply an immediate hiring requirement.

## 2. Current position

| Area | Existing foundation | Remaining work |
| --- | --- | --- |
| Identity and access | Users, single security role per user, permissions, scopes, teams, reporting manager, Supabase authentication and RLS | Consistent project membership enforcement, narrower actions, field protection, accurate staff mapping, negative access tests |
| Acquisition | Campaigns, leads, imports, activity/call logging, accounts and contacts | Research quality queue, calling workbench, callbacks, qualification rules and accepted sales handoffs |
| Sales | Opportunities, quotations, revisions, contracts, catalogue | Enforced stage gates, ownership handoff, discount authority, commercial-to-delivery checklist |
| Products | One catalogue product can carry multiple pricing plans; quote/invoice plan snapshots | Customer-specific subscription agreements, renewal lifecycle, invoice scheduling |
| Delivery | Projects, phases, tasks, members, milestones, risks/issues, changes, time and resource views | Clear assigned-project access, service templates, acceptance gates, calendar/leave-based capacity |
| Content and creative | Generic tasks, notes and documents can support manual coordination | Structured briefs, versioned assets, editorial calendar, version-specific review and publishing lifecycle |
| Client marketing | Campaign attribution foundation | Client-linked campaign delivery, channel metrics, ad-spend versus agency-fee separation |
| Finance | Invoices, payments/allocation, expenses, vendor bills, partner commissions/payouts | Clear preparation/approval/payment separation, recurring drafts, reconciliation and period controls |
| Customer success | Accounts, contacts, contracts and support cases | Named account manager, onboarding, renewal queue, account health and controlled client collaboration |
| External access | Partner portal with partner identity boundary | Separate client review portal and explicit contractor restrictions |
| Automation | Immediate outbound email and activity history | Sequences, scheduling, reply detection and suppression lifecycle; sequence design document is only a proposal |
| People operations | Users, teams, rates and work allocation | Skills, availability/leave, onboarding/offboarding; payroll/recruitment need a separate build-versus-integrate decision |

Relevant implementation: `src/lib/authz.ts`, `src/server/projects.ts`, `src/server/crm.ts`, `src/server/billing.ts`, `src/server/quotations.ts`, `src/app/(app)`, and `supabase` policy/migration files. `docs/roles-and-access.md` contains historical deployment descriptions that conflict with the more recent session review; reconcile them before relying on them.

### Priority access findings

- Existing job roles are Administrator, Sales Manager, Sales Executive, Project Manager, Finance, Consultant, and external Partner. Six active users were observed in the preceding review; department/reporting/job-title setup did not express a functioning organization chart.
- `DEPARTMENT` currently means the reporting subtree, not everyone in the department. Blank manager assignments undermine that model. Label and semantics must agree.
- Internal projects with no account have overly broad visibility in reviewed policies. Project children also have broad internal read/write predicates. A team label in the UI does not establish a secure boundary.
- `project:write` covers too many responsibilities: contributor progress, project administration and member/rate management need separate capabilities.
- `getProjectFormOptions()` uses an administrative client to return employee cost/default billing rates under project-read authorization. Protect sensitive fields in server projections as well as database privileges, including copies in members and time logs.
- Campaign authorization currently shares lead permissions; catalogue authorization shares opportunity permissions. Separate these before introducing specialist staff.
- Preserve existing protections against approving one's own expenses/time, and verify every alternative API/RPC path enforces the same rule.
- Revalidate these findings against the deployed schema before changing policies. No destructive exploit or exhaustive user impersonation was performed for this review.

## 3. Enterprise patterns informing the proposal

- Salesforce describes SDR/BDR work alongside Account Executives. Apply a defined qualification-to-closer handoff instead of making every caller responsible for quoting and closing. [Salesforce sales roles](https://www.salesforce.com/company/careers/teams/sales/)
- HubSpot distinguishes customer lifecycle progression from sales follow-up status. Keep lifecycle, contact outcomes, and deal stages separate. [HubSpot lifecycle stages](https://knowledge.hubspot.com/records/use-lifecycle-stages)
- Productive separates employee, contractor and client access, and distinguishes project/financial visibility from sensitive employee cost rates. Apply deliberate financial access rather than granting it to every project manager. [Productive permission sets](https://help.productive.io/en/articles/16917656-default-permission-sets-employees-clients-and-contractors)
- Authorization should be least-privilege, deny by default and checked on each request. Apply the same rules to server actions, database access, files and exports. [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

## 4. Organization and access model

Keep these concepts separate:

1. Department: business function, such as Growth, Delivery, or Finance.
2. Job title: what the person does, such as Designer or Cold Caller.
3. Security role: the capabilities the application permits.
4. Team/project/account membership: where those capabilities apply.
5. Reporting manager: supervision and escalation.
6. Approval assignment: a specific decision a person may make, within limits.

Initially retain one security role per user, consistent with the existing architecture. Use an explicitly reviewed combined profile when necessary; do not union multiple global scopes. Longer term, consider resource-specific capability grants only with an explicit scope model and migration plan. Business-wide finance access must never accidentally widen lead or credential access.

### Functional responsibilities and proposed boundaries

These are responsibility profiles, not eighteen roles to create immediately.

| Function/profile | Owns | Normal access boundary | Special restriction |
| --- | --- | --- | --- |
| Owner / business director | Strategy, targets, aggregate performance and high-value approvals | Business reports and explicitly assigned approvals | Executive reporting should not require routine system-admin use |
| System administrator | Identity, access, settings and technical operations | Organization configuration | Privileged access remains auditable; founder can initially hold this responsibility |
| Growth / marketing lead | Agency acquisition strategy, campaign budgets, lead quality | Agency marketing and growth team | No invoice settlement or unrestricted payroll/rates |
| Marketing executive | Agency campaigns, landing-page requests, content requests, attribution | Assigned campaigns and relevant results | Publishing and budget approval separately granted |
| Lead researcher | Prospect sourcing, validation, deduplication and enrichment | Assigned research batches | No deal closing, bulk export or mass reassignment by default |
| SDR / cold caller | Outreach, call outcomes, callbacks, qualification and meetings | Assigned leads and permitted contact history | No pricing overrides, invoices or commission approval |
| Sales executive / AE | Discovery, opportunity, proposal, negotiation and handoff | Owned opportunities and linked customer context | Discounts outside approved limits require review |
| Sales manager | Assignment, accepted handoffs, forecast, coaching and permitted discounts | Defined sales team | Cannot approve their own commission obligation |
| Account manager / customer success | Onboarding, client communication, scope coordination, renewals | Assigned client accounts | Does not rewrite approved financial or delivery records silently |
| Project / delivery manager | Scope, tasks, milestones, staffing and acceptance | Managed projects | Rate/profit visibility and approval powers explicitly granted |
| Resource coordinator | Availability, skills and project allocation | Authorized resource pool | Scheduling access does not imply salary or cost-rate access |
| Content / creative lead | Brief quality, editorial plan, review and brand consistency | Assigned content/projects | Review and publishing can be separate capabilities |
| Contributor | Writing, design, video, development, SEO or other assigned execution | Assigned projects/tasks/assets | Own progress/time; no membership, budgets or sensitive rate changes |
| QA / specialist reviewer | Acceptance checks and requested changes | Assigned review items | Approval records identify the version reviewed |
| Publisher / channel operator | Schedule and publish approved content | Explicit channels and approved assets | Editing approved content invalidates that approval |
| Finance operator | Draft invoices, record receipts, expenses and reconciliation preparation | Authorized finance records | Approval/disbursement are separate actions |
| Finance approver / authorized payer | Financial approval and payment authorization | Assigned entities and thresholds | Enforce second-person approval for relevant obligations |
| Contractor | Assigned deliverables and own submissions | Explicit projects/assets with expiry | No employee directory rates, full CRM or unrelated client data |
| Client reviewer | Feedback and approval of shared deliverables | Explicit client account/project shares | Internal comments, costs and other clients are excluded |
| Referral partner | Referred business and allowed commission information | Existing partner boundary | Not interchangeable with a client or employee |

For the current small team, begin with existing Admin, Sales Manager/Executive, PM and Finance profiles; narrow Consultant into Contributor. Add SDR when someone actually calls, Marketing when someone operates campaigns, and an editorial approval capability when content work launches. Keep writer/designer/developer as job titles unless their required access differs. Do not infer staff responsibilities from names or current accidental assignments.

### Permission design

Split broad writes into meaningful capabilities. Proposed examples, not existing permission names:

- Leads: read, create, edit assigned, import, export, assign, qualify and convert.
- Opportunities/quotes: edit owned, submit, approve discount, accept handoff, mark won/lost.
- Projects: create, configure, manage membership, assign tasks, update own task, view budget, view profitability, edit rates.
- Content: create, submit version, review, approve, share externally, schedule, publish, withdraw.
- Finance: prepare invoice, issue invoice, void/credit, record payment, reconcile, approve expense, authorize payout.
- Sensitive data: employee cost read/write, credential reveal, audit read, bulk export.

Scopes must distinguish owned records, assigned work, explicitly shared accounts/projects, defined teams, reporting subtree, and organization. Do not grant organization scope just to make a broken project query work. Check both capability and the target record; parent changes must not escape the boundary. Signed files, exports, realtime subscriptions and administrative-client projections need the same treatment.

## 5. Connected operating workflows

### A. Agency acquisition and outbound

Campaign/source -> research/import -> dedupe/quality check -> assign -> outreach -> qualification -> meeting -> accepted sales handoff -> opportunity.

Required prospect context: company, contact, normalized contact channels, original source, campaign, owner, service interest, qualification notes and next action. Preserve original attribution and track subsequent touches separately.

Keep independent states:

- Lifecycle: prospect, qualified prospect, opportunity/customer relationship; agree exact labels against existing data.
- Contact outcome: no answer, connected, wrong number, callback requested, not interested, do not contact.
- Meeting: booked, held, no-show, rescheduled or cancelled.
- Opportunity stage: discovery, solution/proposal, negotiation and won/lost, with actual entry/exit criteria.

A call attempt is an activity, not a new lead stage. A booked meeting is not a held meeting. Qualification should capture need, contact authority, timing and budget understanding; allow unknown information instead of forcing invented values. The receiving AE accepts or rejects the handoff with a reason. Every active lead needs an owner and dated next action.

Calling workbench: today's queue, overdue callbacks, contact timezone, history, script/qualification checklist, outcome and next-action entry. Start with existing activity records and manual calling; dialer integration comes after provider requirements are agreed. Respect do-not-contact/suppression flags across all channels and automation.

### B. Sales through delivery kickoff

Accepted lead -> discovery -> requirements -> estimate/capacity review -> quote version -> required approval -> customer acceptance/contract -> agreed payment prerequisite -> delivery handoff -> kickoff.

The handoff must contain the account/contact, signed scope, selected plans, inclusions/exclusions, deliverables, dates, billing schedule, acceptance criteria, revision allowance, promises and responsible account/project managers. A PM accepts the handoff or returns missing information. Winning a deal must not imply payment received, unlimited available capacity, or completed work.

Catalogue management gets its own permission. Standard prices are defaults; the accepted commercial agreement is the customer-specific authority. Preserve approved revisions and historical snapshots rather than overwriting past invoices when a catalogue plan changes.

### C. Content management and client marketing

Client/project -> strategy and brand brief -> monthly editorial plan -> individual brief -> writing/design/video -> internal review -> revisions -> client review where required -> approved version -> scheduled -> published -> performance review.

Minimum content item: account/project, campaign purpose, channel, format, objective, audience, caption/script, asset versions, owner, reviewer, due date, publish date/timezone, approval requirements and live URL. Separate internal and client-visible comments. Maintain a brand library for voice, assets, references and reusable templates.

Approval records reference the exact asset/copy version. Changing approved copy or media requires reapproval. A calendar booking is not evidence of successful publication. Manual publishing with a recorded live URL is a valid first release; automated publishing requires channel-specific integration, credential boundaries, retries and failure visibility.

Retainers define deliverable quantities and revision limits. Track requested scope changes and extra work; do not silently consume unlimited revisions. Content performance is evaluated against its objective, not only quantity or impressions.

Distinguish agency self-marketing from marketing delivered for a client. They can share content tooling but require separate client linkage, budgets, access, attribution and reporting. Keep client ad spend separate from the agency service fee.

### D. Development and service delivery

Approved scope -> project template -> phases/tasks -> assignments/dependencies -> execution/time -> specialist QA -> client acceptance -> release/handover -> support.

Use templates for websites, custom software, design, SEO, content retainers and onboarding. Development tasks can add acceptance criteria, review links, test evidence and release checklist without forcing writers into a software-only workflow. Project linking should connect delivery costs/work to a product or customer engagement; catalogue product identity alone must not determine customer access.

Capacity uses working calendars, availability/leave and allocations. Planned hours are not logged hours. Show overload before a manager commits dates. Distinguish internal product development, client delivery and non-billable work when reporting utilization and margins.

### E. Product plans, subscriptions and retainers

One BabulPOS product can have alternative Fixed, Basic Monthly and Pro Monthly plans. A customer agreement chooses a plan. If setup and monthly service are both payable, record them as explicit separate commercial components; choosing one plan must not accidentally bill every alternative.

Existing product plans solve catalogue pricing. A new customer-agreement/subscription layer must hold account, selected plan snapshot, quantity, negotiated price, currency, start/end, billing anchor, renewal/cancellation terms, status and next billing date. Agree proration, upgrades, pauses, cancellation and credit handling before automating them.

Recurring billing initially generates reviewable invoice drafts. Use a unique agreement/component/billing-period key so retries cannot create duplicates. Paid status comes from confirmed payment allocation. Delivery retainers also generate the applicable period's work allowance; do not equate an invoice with a content quota or automatically recognized revenue.

### F. Finance, commission and customer success

Invoice draft -> permitted approval/issue -> collection -> receipt/allocation -> reconciliation. Expenses/vendor obligations have their own submit/review/approve/pay lifecycle. Drafting, approval and disbursement must remain distinguishable, even if the small team shares duties with compensating review.

Define commission policy before extending current partner commissions to employees: eligibility event, calculation base, exclusions, split credit, payment collection threshold, reversals/refunds and approval. Partner referral commission and employee sales incentives may have different rules. Snapshot the applicable rule; do not recalculate old obligations from today's rates.

Account managers own onboarding checkpoints, delivery review, renewal dates, complaints/escalations and expansion opportunities. Client health should explain its inputs (overdue work, payment, support, engagement), not show an unexplained score.

Choose the accounting system of record with Finance. The CRM should not silently become a full payroll/general-ledger/tax engine. Reconcile external accounting references and preserve multi-currency/date-rate context if used.

## 6. Approval ownership

| Decision | Prepares | Reviews/approves | Completion evidence |
| --- | --- | --- | --- |
| Lead handoff | SDR | Receiving AE | Acceptance or rejection reason |
| Nonstandard price/discount | AE | Authorized sales/commercial approver | Approved quote version and threshold |
| Delivery commitment | Sales/AM | PM/resource owner | Scope acceptance and capacity check |
| Content | Contributor | Editor, then client if agreed | Specific approved version |
| Publication | Channel operator | Prior approval gate | Live URL or provider result |
| Time | Contributor | Assigned authorized reviewer | Approved log, no self-approval |
| Expense | Claimant | Independent authorized reviewer | Decision and supporting evidence |
| Payment/payout | Finance preparer | Authorized payer/approver | Approval and reconciled transaction reference |

Set escalation and delegated approvers for absence. Record actor, timestamp, version, reason and authority used. The founder should approve exceptions and significant commitments, not every routine caption. Threshold amounts remain a business decision, not invented defaults in this plan.

## 7. Screens and reporting

Role home pages should answer what to do next: researcher quality queue; caller callbacks; AE follow-ups and proposals; PM capacity/delivery blockers; contributor My Work; editor reviews/calendar; Finance receivables/approvals; owner business performance.

Proposed navigation groups: My Work; Growth (Campaigns, Leads, Calling); Sales (Opportunities, Quotes, Contracts, Catalogue); Delivery (Projects, Content Calendar, Resources, Timesheets); Clients (Accounts, Contacts, Support, Renewals); Finance; Partners; Administration. Render only authorized tools; navigation filtering is not authorization.

Define each KPI before building a chart:

- Growth: qualified/accepted leads by source and spend, with an agreed attribution window.
- Calling: attempts, connected conversations, held meetings and accepted handoffs; do not reward only call count.
- Sales: stage conversion, win rate over a specified cohort, sales cycle, bookings and pipeline aging.
- Content: approved and published items, on-time delivery, revision rounds and client approval delay.
- Delivery: capacity, allocation, approved time, completion against due dates and scope changes.
- Finance: invoiced versus collected, aging, credits, direct costs and clearly defined project contribution margin.
- Customer success: renewals due, retained/lost agreements and support/delivery risks.

Report bookings, invoices, cash collections and accounting revenue separately. Avoid double-counting ad spend or vendor costs. Employee rates require restricted reporting even where aggregate project profitability is visible. Organization dashboards must not bypass record scopes.

## 8. Data and automation approach

Reuse accounts, contacts, activities, projects, tasks, documents, quotes and invoices. Prefer additions with explicit relationships over parallel modules containing duplicate client data.

Likely additions/extensions to design after scope agreement:

- Lead qualification/handoff, meeting outcome and activity dispositions; reuse activity history.
- Content item, content version, version approval, channel and publication result.
- Client agreement/subscription, billable components and period/billing-run records.
- Client account assignment, selective external shares, onboarding/renewal tasks.
- Working availability/leave and skill references for resource planning.
- Scoped capabilities and immutable decision/access audit where current support is insufficient.

Reuse existing approval structures where they fit; assess their schema first rather than automatically introducing a generic workflow engine. Background jobs need idempotency, retry limits, failure queues, deduplication and visible operational status. Integrations should follow stable manual workflows, not precede them.

## 9. Implementation sequence and release gates

| Phase | Deliverable | Acceptance gate |
| --- | --- | --- |
| 0. Baseline | Reconcile deployed migrations/policies, document current actors, clarify service lines and ownership, agree permission matrix | Reviewed current-state map; no blind role reassignment or migration application |
| 1. Access foundation | Narrow contributor permissions, enforce assigned-project boundaries, protect rates, repair staff/team/reporting data and admin projections | Cross-user/project/client negative tests pass through UI, server actions, RPC/database and files |
| 2. Growth and sales | Research queue, caller workbench, outcomes/callbacks, accepted handoff and quote-to-kickoff checklist | One prospect can be followed from source to accepted project without duplicate records or lost ownership |
| 3. Content and delivery | Briefs, editorial calendar, versions, approvals, manual publication evidence, service templates and capacity | One client month runs end-to-end; changed assets invalidate approval; other clients cannot access it |
| 4. Recurring business | Customer agreements, recurring draft invoices, renewal queue and refined commission/payment approvals | One-time and monthly components bill correctly; retry creates no duplicates; credits/cancellation tested |
| 5. Automation and scale | Email/dialer/channel integrations, selected client portal, advanced reporting and accounting sync | Failure recovery, suppression, scope isolation, reconciliation and ownership are demonstrable |

Client review can begin as controlled internal recording of received approval; build secure authenticated external review when needed. Start required client-sharing authorization in phase 1 before introducing a portal.

Do not promise calendar estimates before reviewing each phase's data migration and integration needs. Deliver vertical slices and pilot with actual work. A later phase should not delay fixing a current access defect.

### Verification and rollout

- Use synthetic representative roles and two unrelated projects/accounts to test allowed and denied operations.
- Include direct URL access, list/detail discrepancies, exports, guessed IDs, parent reassignment, administrative projections, database RPCs and files.
- Test deactivated users, removed membership, self-approval, expired external shares and sensitive rate copies.
- Stage data migrations; compare counts/relationships; back up affected data and define policy/role rollback before production rollout.
- Pilot PM/contributor boundaries first, then caller/AE handoff, then one content client and one recurring agreement.
- Update role documentation and in-product field guidance with the implemented behavior. Do not mark a phase complete based only on a successful build.

## 10. Decisions for the working session

1. Which service lines are sold now: software products, custom development, content/social, SEO, paid ads, or others? Identify the first pilot.
2. Map each actual person to job title, reporting manager, team and current client/project responsibilities; do not infer these from current security roles.
3. Who may approve discounts, delivery commitments, content, expenses and payouts, and when is a second approver required?
4. Which channels need integration first, and what accounting system should own the ledger?
5. For monthly business, agree advance/arrears billing, setup fees, cancellation/proration and commission eligibility before automating invoices.

Recommended first implementation package: access foundation plus accurate staff mapping. Then choose one acquisition-to-delivery pilot to validate the operating model before expanding every department.
