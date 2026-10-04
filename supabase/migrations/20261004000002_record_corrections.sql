-- Corrections to records that have been processed.
--
-- Agreed 4 October 2026: before a record is processed, the usual people edit
-- and delete it; once it has been approved, issued, sent, paid, converted or
-- closed, only an administrator may, and only after saying why. Pressing
-- Correct opens a short window on that one record; the reason, who opened it
-- and when are kept here, the field changes themselves in audit_history, and
-- the record's owner is told.
--
-- Two guardrails hold even for an administrator: a closed month stays closed
-- (reopen it first), and an issued invoice or a sent quote keeps its amounts
-- and lines - the customer has them - so only its wording, dates and
-- references are corrected; the figures change through a credit note or a
-- new version.

create table if not exists record_correction (
  id uuid primary key default gen_random_uuid(),
  "entityType" varchar(40) not null,
  "entityId" uuid not null,
  reason text not null check (length(btrim(reason)) >= 5),
  "openedById" uuid not null references app_user (id) on delete restrict,
  "openedAt" timestamp(3) not null default now(),
  "expiresAt" timestamp(3) not null default (now() + interval '30 minutes'),
  -- Set when the corrected record is saved.
  "savedAt" timestamp(3)
);
create index if not exists record_correction_entity_idx on record_correction ("entityType", "entityId", "openedAt" desc);

alter table record_correction enable row level security;
drop policy if exists record_correction_internal_read on record_correction;
create policy record_correction_internal_read on record_correction for select to authenticated using (app_is_internal());
grant select on record_correction to authenticated;

comment on table record_correction is
  'An administrator''s correction of a processed record: the reason and the 30-minute window it opened. Field changes are in audit_history.';
