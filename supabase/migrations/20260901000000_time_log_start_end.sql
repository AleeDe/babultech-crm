-- Record when the work happened, not only how long it took.
--
-- time_log stored `hours` and nothing else, so "8.5 hours on the 31st" could not
-- answer when someone actually worked — which is what a customer asks when they
-- query a bill, and what a manager needs to see whether a day was one stretch or
-- scattered across a dozen interruptions.
--
-- Both columns are nullable, deliberately:
--
--   * Every existing row has hours and no times. Making these NOT NULL would
--     mean inventing times for work already logged and already invoiced, which
--     would be fabricating a record rather than migrating one.
--
--   * "Two hours on this yesterday" is a legitimate entry when nobody wrote the
--     clock times down. Forcing a start and end would push people to make them
--     up, and invented precision is worse than an honest total.
--
-- `hours` stays the source of truth for every downstream consumer — approval,
-- invoicing, cost, utilisation and the burn figures all read it. Where start and
-- end are given the application derives hours from them, so the two can never
-- disagree; where they are not, hours is entered directly as before.
--
-- TIME rather than TIMESTAMP: the date already lives in workDate, and a second
-- date on the same row is a chance for the two to contradict each other. An
-- overnight shift is handled by the application reading an end before the start
-- as crossing midnight.

ALTER TABLE "time_log"
  ADD COLUMN IF NOT EXISTS "startTime" TIME,
  ADD COLUMN IF NOT EXISTS "endTime" TIME;

COMMENT ON COLUMN "time_log"."startTime" IS
  'Clock time work began, or NULL when only a duration was recorded. hours remains the billable figure.';
COMMENT ON COLUMN "time_log"."endTime" IS
  'Clock time work ended. An end before the start means the work crossed midnight.';

-- Either both times are present or neither is. One alone says nothing useful and
-- cannot produce a duration, so it is almost certainly a half-finished entry.
ALTER TABLE "time_log" DROP CONSTRAINT IF EXISTS time_log_times_paired_check;
ALTER TABLE "time_log" ADD CONSTRAINT time_log_times_paired_check CHECK (
  ("startTime" IS NULL AND "endTime" IS NULL)
  OR ("startTime" IS NOT NULL AND "endTime" IS NOT NULL)
);

-- Finding a person's entries for one day is the query behind both the overlap
-- warning and the daily grouping on the timesheet.
CREATE INDEX IF NOT EXISTS time_log_user_date_idx ON "time_log" ("userId", "workDate");
