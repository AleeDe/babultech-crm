-- Row-level security: full rollout.
--
-- Extends the pilot (002) to every remaining scoped table. Depends on the
-- helpers in 001. Apply in order: 001, 002, 003.
--
-- SELECT policies only. Writes still go through the application's
-- requirePermission() checks; write policies are tracked as follow-up in
-- docs/SUPABASE-MIGRATION.md.
--
-- Two families, discriminated by app_current_partner_id():
--   internal (partnerId IS NULL)      -> dataScope over ownerUserId
--   external (partnerId IS NOT NULL)  -> that partner's rows only
--
-- app_is_internal() in every internal policy is load-bearing: Postgres ORs
-- permissive policies together, so without it an external user could match an
-- internal policy and escape partner isolation.

-- ============================================================== internal tables
-- Same shape as opportunity/account in 002: owner-scoped, no external access.

do $$
declare
  t text;
  owner_tables text[] := array[
    'activity', 'campaign', 'contract', 'lead', 'milestone',
    'project_issue', 'project_phase', 'project_risk', 'support_case'
  ];
begin
  foreach t in array owner_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_internal_read', t);
    execute format($f$
      create policy %I on %I
        for select
        using (
          app_is_internal()
          and (
            app_current_scope() = 'ALL'
            or "ownerUserId" in (select app_visible_owner_ids())
          )
        )
    $f$, t || '_internal_read', t);
  end loop;
end $$;

-- ============================================================== partner tables

-- ------------------------------------------------------- opportunity_partner
-- The join table linking deals to partners. An external user sees only their
-- own links; internal users see links on deals they can already see.
alter table opportunity_partner enable row level security;
alter table opportunity_partner force row level security;

drop policy if exists opportunity_partner_internal_read on opportunity_partner;
create policy opportunity_partner_internal_read on opportunity_partner
  for select
  using (
    app_is_internal()
    and (
      app_current_scope() = 'ALL'
      -- definer helper: reading `opportunity` directly here recurses, because
      -- opportunity's external policy reads this table.
      or "opportunityId" in (select app_internal_visible_opportunity_ids())
    )
  );

drop policy if exists opportunity_partner_external_read on opportunity_partner;
create policy opportunity_partner_external_read on opportunity_partner
  for select
  using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
  );

-- --------------------------------------------------------- commission_payout
alter table commission_payout enable row level security;
alter table commission_payout force row level security;

drop policy if exists commission_payout_internal_read on commission_payout;
create policy commission_payout_internal_read on commission_payout
  for select
  using (app_is_internal());

drop policy if exists commission_payout_external_read on commission_payout;
create policy commission_payout_external_read on commission_payout
  for select
  using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
  );

-- ----------------------------------------------------------- partner_contact
alter table partner_contact enable row level security;
alter table partner_contact force row level security;

drop policy if exists partner_contact_internal_read on partner_contact;
create policy partner_contact_internal_read on partner_contact
  for select
  using (app_is_internal());

drop policy if exists partner_contact_external_read on partner_contact;
create policy partner_contact_external_read on partner_contact
  for select
  using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
  );

-- ------------------------------------------------------------------- partner
-- The partner record itself: an external user sees only their own.
alter table partner enable row level security;
alter table partner force row level security;

drop policy if exists partner_internal_read on partner;
create policy partner_internal_read on partner
  for select
  using (app_is_internal());

drop policy if exists partner_external_read on partner;
create policy partner_external_read on partner
  for select
  using (
    app_current_partner_id() is not null
    and id = app_current_partner_id()
  );

-- ------------------------------------------------------------------ app_user
-- Directory data. Internal staff may resolve colleagues (names appear on owned
-- records). An external user may see only their own row -- never the staff
-- directory, and never other partners' portal users.
alter table app_user enable row level security;
alter table app_user force row level security;

drop policy if exists app_user_internal_read on app_user;
create policy app_user_internal_read on app_user
  for select
  using (app_is_internal());

drop policy if exists app_user_self_read on app_user;
create policy app_user_self_read on app_user
  for select
  using (id = app_current_user_id());

-- NOTE: app_user is read by the helper functions themselves. Those are
-- SECURITY DEFINER and therefore bypass these policies, so enabling RLS here
-- does not create a recursive lookup. Verified by the probe in
-- docs/SUPABASE-MIGRATION.md -- without SECURITY DEFINER this deadlocks into
-- every user seeing zero rows.
