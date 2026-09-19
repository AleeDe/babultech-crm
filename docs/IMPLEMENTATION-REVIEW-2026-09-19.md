# Implementation review — 19 September 2026

Update: [fresh user/capacity browser review](USER-CAPACITY-BROWSER-REVIEW.md)
supersedes the earlier browser-blocked status below. Nine browser checks passed;
user creation and notification-email defects were fixed.

Reviewed the supplied continuation transcript, repository history through
`25fa6ca`, operating-model status, capacity implementation, test configuration,
and saved browser reports. This is an incremental review, not a complete
security audit or fresh verification of the deployed database.

## Existing work

The repository includes the finance guards and period locks, recurring contract
billing, customer subscriptions, renewals/health, and client review links described
in the transcript. Saved browser reports record successful synthetic checks for
content (10), leads (15), delivery (17), finance (17), periods (19), client review
(15), invoice permission separation (14), subscriptions (15), and renewals (22).
Those reports record fixture cleanup. They are previous-run evidence, not runs
performed during this review.

## Findings and changes

- Capacity stopped at helpers/server queries; there was no page. Added
  `/resources/capacity` and navigation, requiring project read and management
  capability, with the caller's RLS restricting data.
- Past due unfinished tasks were excluded by the query; elapsed task dates also
  diluted remaining work. Include overdue tasks and distribute remaining work
  from today. The forecast now starts today in Pakistan time.
- Weekend-only work could count twice in separate windows. Attribute it once,
  to its due date. Work against zero availability now flags overload.
- Database row caps could silently truncate a scan below the requested limit.
  Compare exact counts to returned rows and show an incomplete-forecast warning.
- Default tests included legacy live-database suites, including a hierarchy test
  that temporarily rewrites real staff reporting lines. These four suites now
  require `RUN_DATABASE_TESTS=1`; use only a disposable database. The initial
  run could not connect and failed before those writes.

Capacity is an estimate from tasks visible to the viewer. It uses eight-hour
weekdays, without leave, holidays or allocation reservations. Daily overload
analysis now flags individual busy days even when the overall period has spare
hours, lists the affected dates, and prioritizes overloaded people. The interface states these limits and does not advertise low load as
confirmed availability. This does not complete roadmap section D.

## Verification

- Initial run: 608 unit tests passed; four database suites failed setup because
  Supabase fetches failed. Those are not evidence of database correctness.
- Capacity regression tests: 37 passed, including four added edge cases.
- TypeScript check passed after the new page and server changes.
- Final default suite: 612 tests passed across 42 files. Production build passed,
  including `/resources/capacity`. The four live-database suites are excluded
  from this local count and were not rerun.
- Fresh authenticated browser verification of capacity remains pending. The
  earlier automatic approval rejection for the network-enabled test server
  reported a usage limit; no workaround was attempted.

Follow-up: daily overload checks added two regression cases (39 capacity tests).
TypeScript passed; the full local suite now passes 614 tests. Browser verification,
leave and calendar configuration remain pending.

## Remaining approved C/D work

1. Capacity: working calendars, leave and dated allocations, and browser
   verification with independent manager/contributor roles.
2. Service project templates with phases/tasks and explicit QA/handover evidence.
3. Retainer period deliverable allowances, revision limits and scope-change records.
4. Brand library and client advertising spend separated from agency service fees.
5. Narrow editorial capability, performance review and real staff acceptance.

Finance thresholds and second-person payout authorization also remain in the
larger roadmap. Threshold amounts and actual staff ownership require business
decisions; they should not be invented from current names or roles.
