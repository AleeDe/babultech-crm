-- Who brought this customer, and who owns it, are two different questions.
--
-- Owner answers "who at BabulTech works this", and it is not a label: every
-- internal read policy resolves it through app_visible_owner_ids(), which
-- returns the signed-in person and their team or reporting line. Put a partner
-- contact there and the record vanishes for your own staff - a Manager on TEAM
-- scope and a Consultant on OWN scope would both stop seeing it, and it would
-- drop out of every pipeline report, because those filter by owner too.
--
-- Brought-by answers "who gets the credit and the commission". That is what a
-- partner actually wants recorded, and it needs no part of the scope model.
--
-- So: owner stays internal, and attribution becomes its own pair of columns on
-- every record a partner can create. account already had sourcePartnerId;
-- contact and opportunity get the same, and all three also record WHICH PERSON
-- at the partner, which nothing tracked before.

-- ---------------------------------------------------------------------------
-- 1. The attribution columns
-- ---------------------------------------------------------------------------

alter table account
  add column if not exists "sourcePartnerUserId" uuid
    references app_user (id) on delete set null;

alter table contact
  add column if not exists "sourcePartnerId" uuid
    references partner (id) on delete set null,
  add column if not exists "sourcePartnerUserId" uuid
    references app_user (id) on delete set null;

alter table opportunity
  add column if not exists "sourcePartnerId" uuid
    references partner (id) on delete set null,
  add column if not exists "sourcePartnerUserId" uuid
    references app_user (id) on delete set null;

-- The deal link carries the commission relationship - share, override, plan,
-- registration window - so the person belongs here too rather than in a second
-- place that could disagree with it.
alter table opportunity_partner
  add column if not exists "partnerUserId" uuid
    references app_user (id) on delete set null;

comment on column account."sourcePartnerUserId" is
  'The partner login that created this. Set from the session, never from a form.';

create index if not exists "contact_sourcePartner_idx"
  on contact ("sourcePartnerId") where "sourcePartnerId" is not null;
create index if not exists "opportunity_sourcePartner_idx"
  on opportunity ("sourcePartnerId") where "sourcePartnerId" is not null;

-- ---------------------------------------------------------------------------
-- 2. Write-once
-- ---------------------------------------------------------------------------
--
-- Attribution decides who gets paid, so once it is stamped nobody may change
-- it - not staff, not the partner, not a stray update from a screen that meant
-- to change something else. Clearing it is refused for the same reason.
--
-- Setting it on a record that has none is allowed: a deal somebody typed in
-- before anyone realised a partner had introduced it can still be credited.
create or replace function guard_attribution_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE' then return new; end if;

  if old."sourcePartnerId" is not null
     and new."sourcePartnerId" is distinct from old."sourcePartnerId" then
    raise exception
      'Who brought this customer cannot be changed once recorded. It decides who is paid commission.'
      using errcode = '42501';
  end if;

  if old."sourcePartnerUserId" is not null
     and new."sourcePartnerUserId" is distinct from old."sourcePartnerUserId" then
    raise exception
      'Who at the partner brought this cannot be changed once recorded.'
      using errcode = '42501';
  end if;

  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['account', 'contact', 'opportunity'] loop
    execute format('drop trigger if exists %I on %I', t || '_attribution_immutable', t);
    execute format(
      'create trigger %I before update on %I for each row execute function guard_attribution_immutable()',
      t || '_attribution_immutable', t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Backfill what is already known
-- ---------------------------------------------------------------------------
--
-- A contact at an account a partner sourced was brought by that partner, and
-- so was a deal at it. Done once here so existing records are not left as the
-- only ones without attribution.
update contact c
   set "sourcePartnerId" = a."sourcePartnerId"
  from account a
 where a.id = c."accountId"
   and a."sourcePartnerId" is not null
   and c."sourcePartnerId" is null;

update opportunity o
   set "sourcePartnerId" = a."sourcePartnerId"
  from account a
 where a.id = o."accountId"
   and a."sourcePartnerId" is not null
   and o."sourcePartnerId" is null;

-- ---------------------------------------------------------------------------
-- 4. A partner sees the customers they brought, and no longer their own company
-- ---------------------------------------------------------------------------
--
-- The previous version also showed a partner their own account, added for a
-- portal page that has since been removed. It left their own company sitting
-- in their Accounts list beside their customers, with buttons that could not
-- work - the function refuses a deal against an account nobody sourced, which
-- is exactly right and read as a bug.
--
-- Their own company belongs on Overview, where the partnership already is.
drop policy if exists account_partner_read on account;
create policy account_partner_read on account
  for select
  using (
    app_current_partner_id() is not null
    and "sourcePartnerId" = app_current_partner_id()
  );

drop policy if exists contact_partner_read on contact;
create policy contact_partner_read on contact
  for select
  using (
    app_current_partner_id() is not null
    and (
      "sourcePartnerId" = app_current_partner_id()
      or "accountId" in (
        select a.id from account a
        where a."sourcePartnerId" = app_current_partner_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Reference lists a partner needs to fill in a form
-- ---------------------------------------------------------------------------
--
-- A partner could read no currencies and no picklist values at all, so the
-- currency dropdown on their own deal form came up empty and every list fell
-- back to whatever was hardcoded behind it. Neither table holds anything
-- confidential: they are the words the form is made of.
--
-- Deliberately not product or price_book. What something costs is ours.
drop policy if exists currency_partner_read on currency;
create policy currency_partner_read on currency
  for select
  using (app_current_partner_id() is not null and active);

drop policy if exists picklist_partner_read on picklist;
create policy picklist_partner_read on picklist
  for select
  using (app_current_partner_id() is not null);

drop policy if exists picklist_value_partner_read on picklist_value;
create policy picklist_value_partner_read on picklist_value
  for select
  using (app_current_partner_id() is not null and active);

-- ---------------------------------------------------------------------------
-- 6. Stamping attribution when a partner creates something
-- ---------------------------------------------------------------------------

create or replace function partner_create_customer(
  p_account_name  text,
  p_first_name    text,
  p_last_name     text,
  p_email         text default null,
  p_phone         text default null,
  p_job_title     text default null,
  p_industry      text default null,
  p_city          text default null,
  p_website       text default null,
  p_deal_name     text default null,
  p_deal_amount   numeric default null,
  p_deal_close    date default null,
  p_deal_currency text default 'PKR',
  p_notes         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner    uuid := app_current_partner_id();
  v_user       uuid := app_current_user_id();
  v_partner_row record;
  v_owner      uuid;
  v_account    uuid := gen_random_uuid();
  v_contact    uuid := gen_random_uuid();
  v_opp        uuid;
  v_link       uuid;
  v_acct_no    text;
  v_opp_no     text;
  v_conflict   jsonb;
  v_contested  boolean := false;
begin
  if v_partner is null then
    raise exception 'Only a partner may create a customer here.';
  end if;
  if coalesce(btrim(p_account_name), '') = '' then
    raise exception 'The company needs a name.';
  end if;
  if coalesce(btrim(p_first_name), '') = '' or coalesce(btrim(p_last_name), '') = '' then
    raise exception 'The contact needs a first and last name.';
  end if;

  select id, "displayName", status, "partnerManagerId", "agreementExpiryDate"
    into v_partner_row
  from partner where id = v_partner;

  if v_partner_row.status <> 'ACTIVE' then
    raise exception 'Only an active partnership can add customers. Please speak to your partner manager.';
  end if;
  if v_partner_row."agreementExpiryDate" is not null
     and v_partner_row."agreementExpiryDate" < current_date then
    raise exception 'Your partner agreement has expired, so new customers cannot be added. Please speak to your partner manager.';
  end if;

  v_conflict := partner_find_conflict(p_account_name, p_email, p_phone);
  v_contested := coalesce((v_conflict ->> 'conflict')::boolean, false)
                 and not coalesce((v_conflict ->> 'mine')::boolean, false);

  v_owner := v_partner_row."partnerManagerId";
  if v_owner is null then
    select u.id into v_owner
    from app_user u
    join security_role r on r.id = u."roleId"
    where u."deletedAt" is null
      and u.status = 'ACTIVE'
      and u."userType" = 'INTERNAL'
      and r.permissions @> array['*']
    order by u."createdAt"
    limit 1;
  end if;
  if v_owner is null then
    raise exception 'No internal owner could be found for this customer. Please speak to your partner manager.';
  end if;

  v_acct_no := next_sequence_number('Account');

  insert into account (
    id, "accountNumber", name, "accountType", "customerStatus", "ownerUserId",
    industry, website, "billingAddress", "sourcePartnerId", "sourcePartnerUserId",
    "registrationContested", description, "createdAt", "updatedAt"
  ) values (
    v_account, v_acct_no, btrim(p_account_name), 'PROSPECT', 'ONBOARDING', v_owner,
    nullif(btrim(coalesce(p_industry, '')), ''),
    nullif(btrim(coalesce(p_website, '')), ''),
    case when nullif(btrim(coalesce(p_city, '')), '') is null then null
         else jsonb_build_object('city', btrim(p_city)) end,
    v_partner, v_user, v_contested,
    nullif(btrim(coalesce(p_notes, '')), ''),
    now(), now()
  );

  insert into contact (
    id, "accountId", "firstName", "lastName", "jobTitle", email, phone,
    "isPrimary", active, "sourcePartnerId", "sourcePartnerUserId", "createdAt", "updatedAt"
  ) values (
    v_contact, v_account, btrim(p_first_name), btrim(p_last_name),
    nullif(btrim(coalesce(p_job_title, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    true, true, v_partner, v_user, now(), now()
  );

  if coalesce(btrim(coalesce(p_deal_name, '')), '') <> '' then
    v_opp := gen_random_uuid();
    v_link := gen_random_uuid();
    v_opp_no := next_sequence_number('Opportunity');

    insert into opportunity (
      id, "opportunityNumber", name, "accountId", "primaryContactId",
      "ownerUserId", stage, amount, "currencyCode", "expectedCloseDate",
      "opportunityType", "leadSource", "sourcePartnerId", "sourcePartnerUserId",
      description, "createdAt", "updatedAt"
    ) values (
      v_opp, v_opp_no, btrim(p_deal_name), v_account, v_contact,
      v_owner, 'DISCOVERY', coalesce(p_deal_amount, 0),
      coalesce(nullif(btrim(coalesce(p_deal_currency, '')), ''), 'PKR'),
      coalesce(p_deal_close, current_date + 30),
      'NEW', 'Partner', v_partner, v_user,
      nullif(btrim(coalesce(p_notes, '')), ''),
      now(), now()
    );

    insert into opportunity_partner (
      id, "opportunityId", "partnerId", "partnerUserId", role,
      "revenueSharePercent", "registeredAt", "createdAt", "updatedAt"
    ) values (
      v_link, v_opp, v_partner, v_user, 'SOURCED', 100, now(), now(), now()
    );
  end if;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'Account', v_account, 'created', null,
    'Created in the partner portal by ' || v_partner_row."displayName"
      || case when v_contested then ' (contested)' else '' end,
    v_user, 'portal', now()
  );

  return jsonb_build_object(
    'accountId', v_account, 'accountNumber', v_acct_no, 'contactId', v_contact,
    'opportunityId', v_opp, 'opportunityNumber', v_opp_no,
    'contested', v_contested, 'conflict', v_conflict
  );
end;
$$;

create or replace function partner_add_contact(
  p_account_id uuid,
  p_first_name text,
  p_last_name  text,
  p_email      text default null,
  p_phone      text default null,
  p_job_title  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_user    uuid := app_current_user_id();
  v_id      uuid := gen_random_uuid();
  v_owned   boolean;
begin
  if v_partner is null then
    raise exception 'Only a partner may add a contact here.';
  end if;

  select exists (
    select 1 from account
    where id = p_account_id and "deletedAt" is null
      and "sourcePartnerId" = v_partner
  ) into v_owned;

  if not v_owned then
    raise exception 'That customer is not one of yours.';
  end if;
  if coalesce(btrim(p_first_name), '') = '' or coalesce(btrim(p_last_name), '') = '' then
    raise exception 'The contact needs a first and last name.';
  end if;

  insert into contact (
    id, "accountId", "firstName", "lastName", "jobTitle", email, phone,
    "isPrimary", active, "sourcePartnerId", "sourcePartnerUserId", "createdAt", "updatedAt"
  ) values (
    v_id, p_account_id, btrim(p_first_name), btrim(p_last_name),
    nullif(btrim(coalesce(p_job_title, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    false, true, v_partner, v_user, now(), now()
  );

  return jsonb_build_object('contactId', v_id);
end;
$$;

revoke all on function partner_create_customer(text, text, text, text, text, text, text, text, text, text, numeric, date, text, text) from public;
revoke all on function partner_add_contact(uuid, text, text, text, text, text) from public;
grant execute on function partner_create_customer(text, text, text, text, text, text, text, text, text, text, numeric, date, text, text) to authenticated;
grant execute on function partner_add_contact(uuid, text, text, text, text, text) to authenticated;
