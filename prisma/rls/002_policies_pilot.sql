-- Row-level security: pilot policies.
--
-- Three representative tables, per docs/SUPABASE-MIGRATION.md step 3:
--   opportunity        -- internal, ownerUserId-scoped (OWN/TEAM/DEPT/ALL)
--   commission_record  -- external, partnerId-isolated (portal path)
--   account            -- internal, second table to prove the pattern repeats
--
-- The remaining tables are NOT converted yet. Roll them out only once the
-- characterization tests pass against these three with the application-level
-- filter removed.
--
-- Two policy families, discriminated by app_current_partner_id():
--   internal  (partnerId IS NULL)     -> dataScope over ownerUserId
--   external  (partnerId IS NOT NULL) -> that partner's rows only
--
-- The failure that matters is an external user matching an internal policy.
-- Postgres ORs multiple permissive policies together, so each family's
-- predicate must explicitly exclude the other -- app_is_internal() in the
-- internal policies is load-bearing, not decorative.

-- ---------------------------------------------------------------- opportunity
alter table opportunity enable row level security;
alter table opportunity force row level security;

drop policy if exists opportunity_internal_read on opportunity;
create policy opportunity_internal_read on opportunity
  for select
  using (
    app_is_internal()
    and (
      app_current_scope() = 'ALL'
      or "ownerUserId" in (select app_visible_owner_ids())
    )
  );

-- External users reach a deal only through their own partner link.
drop policy if exists opportunity_external_read on opportunity;
create policy opportunity_external_read on opportunity
  for select
  using (
    app_current_partner_id() is not null
    -- via SECURITY DEFINER helper, not a direct read of opportunity_partner:
    -- that table's policies reference opportunity, which would recurse.
    and id in (select app_partner_opportunity_ids())
  );

-- ---------------------------------------------------------- commission_record
alter table commission_record enable row level security;
alter table commission_record force row level security;

drop policy if exists commission_record_internal_read on commission_record;
create policy commission_record_internal_read on commission_record
  for select
  using (
    app_is_internal()
    and (
      app_current_scope() = 'ALL'
      -- definer helper, same recursion reason as the opportunity policy
      or "opportunityId" in (select app_internal_visible_opportunity_ids())
    )
  );

-- The portal isolation rule: own partner's commission, nothing else.
drop policy if exists commission_record_external_read on commission_record;
create policy commission_record_external_read on commission_record
  for select
  using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
  );

-- -------------------------------------------------------------------- account
alter table account enable row level security;
alter table account force row level security;

drop policy if exists account_internal_read on account;
create policy account_internal_read on account
  for select
  using (
    app_is_internal()
    and (
      app_current_scope() = 'ALL'
      or "ownerUserId" in (select app_visible_owner_ids())
    )
  );

-- No external policy on account: partners have no account visibility today.
-- Absent a permissive policy, external users see zero rows here, which is the
-- intended default.
