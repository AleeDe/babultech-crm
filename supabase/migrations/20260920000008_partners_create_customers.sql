-- Let a partner bring us a customer, not just tell us about one.
--
-- Until now a partner could register a deal, which created a lead for someone
-- internal to work. That suited a referral network. It does not suit partners
-- who run their own sales cycle and come to us with the customer already won,
-- which is what ours actually do: they want the account, the contact and the
-- opportunity to exist, under their name, the moment the customer goes hot.
--
-- Three decisions shape everything below.
--
-- 1. Partners get no INSERT policies. Granting a partner direct INSERT on
--    account, contact and opportunity would be a very wide surface to defend -
--    every column, every enum, every foreign key, forever. Instead there is one
--    SECURITY DEFINER function that takes exactly the fields a partner may set
--    and writes the rest itself. What a partner can create is then a property
--    of this function rather than of the tables.
--
-- 2. Every partner-created account carries an internal owner. account.ownerUserId
--    is NOT NULL and the whole internal data-scope model hangs off it; an
--    ownerless account would be invisible to the people meant to work it. The
--    owner is the partner's manager, and where a partner has none, whoever
--    administers the system - never the partner, who is not an internal user.
--
-- 3. A conflict does not block the write. If the customer is already ours or
--    already another partner's, refusing would tell the partner nothing and
--    lose the record of them having tried. The account is created, flagged, and
--    the partner is told plainly. Sorting out who owns the relationship is a
--    conversation between people, and it can only happen if both sides can see
--    that there is one.

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

alter table account
  -- Which partner brought this customer. Also what the partner's own portal
  -- filters on, so it is the difference between an account they can see and one
  -- they cannot.
  add column if not exists "sourcePartnerId" uuid
    references partner (id) on delete set null,
  -- Set when the account matched something that already existed. Deliberately
  -- not a status the partner can clear: it is a note to us, and it stays until
  -- somebody internal resolves it.
  add column if not exists "registrationContested" boolean not null default false;

create index if not exists "account_sourcePartnerId_idx"
  on account ("sourcePartnerId") where "sourcePartnerId" is not null;

-- ---------------------------------------------------------------------------
-- What a partner may see
-- ---------------------------------------------------------------------------
--
-- Previously nothing: "partners have no account visibility today". Now they see
-- the accounts they themselves sourced, and the contacts at those accounts.
-- Not their deals' accounts in general - a deal can be attached to an account
-- that was always ours, and sourcing is the only claim that makes an account
-- theirs to look at.

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
    and "accountId" in (
      select a.id from account a
      where a."sourcePartnerId" = app_current_partner_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Is this customer already known?
-- ---------------------------------------------------------------------------
--
-- Matched on account name, contact email or contact phone - the three things a
-- partner will have before anything else. Any one of them is enough: a partner
-- typing a name that is already ours should be told so even if they have a
-- different contact at the company.
--
-- What comes back is deliberately thin. It answers "is this mine, and if not
-- whose?" and stops there. It does not return the existing contact's email or
-- phone, because a partner who could read those by typing names at this
-- function would have a way to harvest another partner's customer list one
-- guess at a time. Whoever needs those details can be told by a person.
create or replace function partner_find_conflict(
  p_account_name text,
  p_email        text default null,
  p_phone        text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_account record;
begin
  if v_partner is null then
    raise exception 'Only a partner may check for a conflict.';
  end if;

  select a.id, a.name, a."billingAddress" ->> 'city' as city,
         a."accountType", a."customerStatus",
         a."sourcePartnerId", a."createdAt",
         p."displayName" as "sourcePartnerName"
    into v_account
  from account a
  left join partner p on p.id = a."sourcePartnerId"
  where a."deletedAt" is null
    and (
      lower(btrim(a.name)) = lower(btrim(p_account_name))
      or (
        nullif(btrim(coalesce(p_email, '')), '') is not null
        and exists (
          select 1 from contact c
          where c."accountId" = a.id
            and c."deletedAt" is null
            and lower(c.email) = lower(btrim(p_email))
        )
      )
      or (
        -- Digits only: a number typed as +92 300 1234567 and one typed as
        -- 03001234567 are the same number, and a partner should not be able to
        -- register a duplicate by reformatting it.
        length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 7
        and exists (
          select 1 from contact c
          where c."accountId" = a.id
            and c."deletedAt" is null
            and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g')
                = regexp_replace(p_phone, '\D', '', 'g')
        )
      )
    )
  order by a."createdAt"
  limit 1;

  if v_account.id is null then
    return jsonb_build_object('conflict', false);
  end if;

  return jsonb_build_object(
    'conflict', true,
    'mine', v_account."sourcePartnerId" is not distinct from v_partner,
    'accountName', v_account.name,
    'city', v_account.city,
    'accountType', v_account."accountType",
    'customerStatus', v_account."customerStatus",
    'registeredOn', to_char(v_account."createdAt", 'YYYY-MM-DD'),
    -- Named only when another partner brought them. Where the customer is
    -- simply ours, the partner is told that and no more.
    'broughtBy', case
      when v_account."sourcePartnerId" is null then null
      when v_account."sourcePartnerId" = v_partner then 'you'
      else v_account."sourcePartnerName"
    end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Create the customer
-- ---------------------------------------------------------------------------
--
-- One call makes the account, its primary contact and - when the partner is
-- ready for it - the opportunity and the partner link that entitles them to
-- commission on it. One call because these are worthless apart: an account with
-- no contact cannot be sold to, and a deal with no partner link pays nobody.
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

  -- The same two gates deal registration already applies. A lapsed partner
  -- creating customers would be building a commission claim on an agreement
  -- that no longer exists.
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

  -- Somebody internal must own this. The partner's manager knows the
  -- relationship; failing that, an administrator, so the record is never
  -- orphaned. Ordered by creation so the choice is stable rather than whichever
  -- row the planner happened to return.
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
    industry, website, "billingAddress", "sourcePartnerId", "registrationContested",
    description, "createdAt", "updatedAt"
  ) values (
    v_account, v_acct_no, btrim(p_account_name), 'PROSPECT', 'ONBOARDING', v_owner,
    nullif(btrim(coalesce(p_industry, '')), ''),
    nullif(btrim(coalesce(p_website, '')), ''),
    case when nullif(btrim(coalesce(p_city, '')), '') is null then null
         else jsonb_build_object('city', btrim(p_city)) end,
    v_partner, v_contested,
    nullif(btrim(coalesce(p_notes, '')), ''),
    now(), now()
  );

  insert into contact (
    id, "accountId", "firstName", "lastName", "jobTitle", email, phone,
    "isPrimary", active, "createdAt", "updatedAt"
  ) values (
    v_contact, v_account, btrim(p_first_name), btrim(p_last_name),
    nullif(btrim(coalesce(p_job_title, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    true, true, now(), now()
  );

  -- The deal is optional. A partner often has the customer before they have a
  -- number to put on it, and forcing an invented figure would make the pipeline
  -- worse, not better.
  if coalesce(btrim(coalesce(p_deal_name, '')), '') <> '' then
    v_opp := gen_random_uuid();
    v_link := gen_random_uuid();
    v_opp_no := next_sequence_number('Opportunity');

    insert into opportunity (
      id, "opportunityNumber", name, "accountId", "primaryContactId",
      "ownerUserId", stage, amount, "currencyCode", "expectedCloseDate",
      "opportunityType", "leadSource", description, "createdAt", "updatedAt"
    ) values (
      v_opp, v_opp_no, btrim(p_deal_name), v_account, v_contact,
      v_owner, 'DISCOVERY', coalesce(p_deal_amount, 0),
      coalesce(nullif(btrim(coalesce(p_deal_currency, '')), ''), 'PKR'),
      coalesce(p_deal_close, current_date + 30),
      'NEW', 'Partner', nullif(btrim(coalesce(p_notes, '')), ''),
      now(), now()
    );

    -- SOURCED, and the registration clock starts now. Without this row the
    -- partner has no claim on the deal at all, whoever typed it in.
    insert into opportunity_partner (
      id, "opportunityId", "partnerId", role, "revenueSharePercent",
      "registeredAt", "createdAt", "updatedAt"
    ) values (
      v_link, v_opp, v_partner, 'SOURCED', 100, now(), now(), now()
    );
  end if;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'Account', v_account, 'created', null,
    'Created in the partner portal by ' || v_partner_row."displayName"
      || case when v_contested then ' (contested)' else '' end,
    app_current_user_id(), 'portal', now()
  );

  return jsonb_build_object(
    'accountId', v_account,
    'accountNumber', v_acct_no,
    'contactId', v_contact,
    'opportunityId', v_opp,
    'opportunityNumber', v_opp_no,
    'contested', v_contested,
    'conflict', v_conflict
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Add a contact to a customer the partner already brought
-- ---------------------------------------------------------------------------

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
  v_id      uuid := gen_random_uuid();
  v_owned   boolean;
begin
  if v_partner is null then
    raise exception 'Only a partner may add a contact here.';
  end if;

  select exists (
    select 1 from account
    where id = p_account_id
      and "deletedAt" is null
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
    "isPrimary", active, "createdAt", "updatedAt"
  ) values (
    v_id, p_account_id, btrim(p_first_name), btrim(p_last_name),
    nullif(btrim(coalesce(p_job_title, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    false, true, now(), now()
  );

  return jsonb_build_object('contactId', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Add a deal against a customer the partner already brought
-- ---------------------------------------------------------------------------

create or replace function partner_add_opportunity(
  p_account_id  uuid,
  p_name        text,
  p_amount      numeric default 0,
  p_close_date  date default null,
  p_currency    text default 'PKR',
  p_contact_id  uuid default null,
  p_notes       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner uuid := app_current_partner_id();
  v_id      uuid := gen_random_uuid();
  v_number  text;
  v_owner   uuid;
  v_status  text;
begin
  if v_partner is null then
    raise exception 'Only a partner may add a deal here.';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'The deal needs a name.';
  end if;

  select a."ownerUserId" into v_owner
  from account a
  where a.id = p_account_id
    and a."deletedAt" is null
    and a."sourcePartnerId" = v_partner;

  if v_owner is null then
    raise exception 'That customer is not one of yours.';
  end if;

  select status into v_status from partner where id = v_partner;
  if v_status <> 'ACTIVE' then
    raise exception 'Only an active partnership can add deals. Please speak to your partner manager.';
  end if;

  -- A contact given must belong to that account, or the deal would point at
  -- somebody else's customer.
  if p_contact_id is not null
     and not exists (
       select 1 from contact
       where id = p_contact_id and "accountId" = p_account_id and "deletedAt" is null
     ) then
    raise exception 'That contact does not work at this customer.';
  end if;

  v_number := next_sequence_number('Opportunity');

  insert into opportunity (
    id, "opportunityNumber", name, "accountId", "primaryContactId",
    "ownerUserId", stage, amount, "currencyCode", "expectedCloseDate",
    "opportunityType", "leadSource", description, "createdAt", "updatedAt"
  ) values (
    v_id, v_number, btrim(p_name), p_account_id, p_contact_id,
    v_owner, 'DISCOVERY', coalesce(p_amount, 0),
    coalesce(nullif(btrim(coalesce(p_currency, '')), ''), 'PKR'),
    coalesce(p_close_date, current_date + 30),
    'NEW', 'Partner', nullif(btrim(coalesce(p_notes, '')), ''),
    now(), now()
  );

  insert into opportunity_partner (
    id, "opportunityId", "partnerId", role, "revenueSharePercent",
    "registeredAt", "createdAt", "updatedAt"
  ) values (
    gen_random_uuid(), v_id, v_partner, 'SOURCED', 100, now(), now(), now()
  );

  return jsonb_build_object('opportunityId', v_id, 'opportunityNumber', v_number);
end;
$$;

revoke all on function partner_find_conflict(text, text, text) from public;
revoke all on function partner_create_customer(text, text, text, text, text, text, text, text, text, text, numeric, date, text, text) from public;
revoke all on function partner_add_contact(uuid, text, text, text, text, text) from public;
revoke all on function partner_add_opportunity(uuid, text, numeric, date, text, uuid, text) from public;

grant execute on function partner_find_conflict(text, text, text) to authenticated;
grant execute on function partner_create_customer(text, text, text, text, text, text, text, text, text, text, numeric, date, text, text) to authenticated;
grant execute on function partner_add_contact(uuid, text, text, text, text, text) to authenticated;
grant execute on function partner_add_opportunity(uuid, text, numeric, date, text, uuid, text) to authenticated;
