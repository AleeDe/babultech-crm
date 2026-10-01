-- Merging duplicate contacts and accounts, and a history of every merge.
--
-- Leads already merge (20260926000002). Contacts and accounts follow the same
-- rules: somebody picks the record to keep and, field by field, the values to
-- keep; everything attached to the others moves across; the others are retired
-- (soft-deleted and stamped "mergedIntoId"), never removed, so a mistaken merge
-- can be seen and argued with.
--
-- Refused rather than half-handled:
--   - two contacts that both have a portal login, or are both a partner's person;
--   - an account that is a partner being merged away (keep the partner's account);
--   - two accounts credited to different partners - credit decides commission;
--   - anything that would change an invoice, payment or expense in a closed month.

alter table contact
  add column if not exists "mergedIntoId" uuid references contact (id) on delete set null,
  add column if not exists "mergedAt" timestamp(3);
alter table account
  add column if not exists "mergedIntoId" uuid references account (id) on delete set null,
  add column if not exists "mergedAt" timestamp(3);

create table if not exists record_merge (
  id uuid primary key default gen_random_uuid(),
  "entityType" varchar(20) not null check ("entityType" in ('Lead', 'Contact', 'Account')),
  "survivorId" uuid not null,
  "mergedIds" uuid[] not null,
  -- The values chosen for the record kept, and how many linked rows moved.
  "chosenValues" jsonb not null default '{}'::jsonb,
  "recordsMoved" integer not null default 0,
  "mergedById" uuid references app_user (id) on delete set null,
  "mergedAt" timestamp(3) not null default now()
);
create index if not exists record_merge_survivor_idx on record_merge ("entityType", "survivorId");

alter table record_merge enable row level security;
drop policy if exists record_merge_internal_read on record_merge;
create policy record_merge_internal_read on record_merge for select to authenticated using (app_is_internal());
grant select on record_merge to authenticated;

-- ---------------------------------------------------------------------------
-- Moving the records that hang off a contact or an account
-- ---------------------------------------------------------------------------

-- The polymorphic links: notes, documents, emails, activities, approvals and
-- followers point at ("relatedEntityType", "relatedEntityId") with no foreign
-- key, so they are moved by hand. Recently viewed entries are just dropped.
create or replace function merge_move_polymorphic(p_type text, p_from uuid, p_to uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
  v_total integer := 0;
  v_table text;
begin
  foreach v_table in array array['activity', 'email', 'note', 'document', 'approval_request'] loop
    execute format('update %I set "relatedEntityId" = $1 where "relatedEntityType" = $2 and "relatedEntityId" = $3', v_table)
      using p_to, p_type, p_from;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  insert into record_follow ("userId", "entityType", "entityId", "createdAt")
  select f."userId", f."entityType", p_to, f."createdAt" from record_follow f
  where f."entityType" = p_type and f."entityId" = p_from
  on conflict do nothing;
  delete from record_follow where "entityType" = p_type and "entityId" = p_from;
  delete from recent_record where "entityType" = p_type and "entityId" = p_from;
  return v_total;
end $$;

revoke all on function merge_move_polymorphic(text, uuid, uuid) from public, anon, authenticated;

-- Applies chosen values to the record kept. Only whitelisted columns, each cast
-- to its own type; a caller cannot name any other column.
create or replace function merge_apply_values(p_table text, p_id uuid, p_values jsonb, p_columns text[], p_types text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  i integer;
begin
  for i in 1 .. coalesce(array_length(p_columns, 1), 0) loop
    if p_values ? p_columns[i] then
      execute format('update %I set %I = nullif(btrim(coalesce($1, '''')), '''')::%s where id = $2', p_table, p_columns[i], p_types[i])
        using p_values ->> p_columns[i], p_id;
    end if;
  end loop;
end $$;

revoke all on function merge_apply_values(text, uuid, jsonb, text[], text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
create or replace function merge_contacts(p_survivor uuid, p_losers uuid[], p_values jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := app_current_user_id();
  v_all uuid[] := p_losers || p_survivor;
  v_loser uuid;
  v_moved integer := 0;
  v_n integer;
  v_merged integer;
  v_pair record;
  v_cols text[] := array['firstName', 'lastName', 'jobTitle', 'department', 'email', 'phone', 'mobile', 'whatsapp', 'contactRole', 'accountId'];
  v_types text[] := array['varchar', 'varchar', 'varchar', 'varchar', 'varchar', 'varchar', 'varchar', 'varchar', 'varchar', 'uuid'];
begin
  if not (app_is_internal() and app_has_permission('account:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'Choose at least one duplicate to merge in.';
  end if;
  if p_survivor = any(p_losers) then
    raise exception 'A contact cannot be merged into itself.';
  end if;
  if (select count(*) from contact where id = any(v_all) and "deletedAt" is null) <> array_length(v_all, 1) then
    raise exception 'One of those contacts no longer exists.';
  end if;
  perform 1 from contact where id = any(v_all) for update;

  if (select count(*) from app_user where "contactId" = any(v_all)) > 1 then
    raise exception 'More than one of these people has a portal login. Switch one login off and remove its access before merging.' using errcode = '23514';
  end if;
  if (select count(*) from partner where "contactId" = any(v_all)) > 1 then
    raise exception 'More than one of these is a partner''s person. They cannot be merged.' using errcode = '23514';
  end if;
  if p_values ? 'accountId' and nullif(p_values ->> 'accountId', '') is not null
     and not exists (select 1 from contact where id = any(v_all) and "accountId"::text = p_values ->> 'accountId') then
    raise exception 'The account kept must be one of these contacts'' accounts.';
  end if;
  if exists (select 1 from invoice where "contactId" = any(p_losers) and period_is_locked("invoiceDate")) then
    raise exception 'A contact being merged away is on an invoice in a closed month. Reopen that month first, or keep both.' using errcode = '23514';
  end if;

  -- Retire the losers first, so the duplicate rule does not see the survivor
  -- taking a loser's email or number as a clash.
  update contact set "mergedIntoId" = p_survivor, "mergedAt" = now(), "deletedAt" = now(), "deletedById" = v_actor
  where id = any(p_losers);
  get diagnostics v_merged = row_count;

  perform merge_apply_values('contact', p_survivor, p_values, v_cols, v_types);
  update contact set "lastName" = '-' where id = p_survivor and coalesce("lastName", '') = '';
  update contact s set
    -- An opt-out on any of them stands: they asked not to be emailed.
    "emailOptOut" = s."emailOptOut" or exists (select 1 from contact l where l.id = any(p_losers) and l."emailOptOut"),
    "emailOptOutAt" = coalesce(s."emailOptOutAt", (select max(l."emailOptOutAt") from contact l where l.id = any(p_losers))),
    "isPrimary" = s."isPrimary" or exists (select 1 from contact l where l.id = any(p_losers) and l."isPrimary" and l."accountId" is not distinct from s."accountId"),
    "updatedAt" = now()
  where s.id = p_survivor;

  foreach v_loser in array p_losers loop
    for v_pair in select * from (values
      ('activity', 'contactId'), ('campaign_interaction', 'contactId'), ('campaign_member', 'contactId'),
      ('case_comment', 'authorContactId'), ('change_request', 'requestedByContactId'), ('invoice', 'contactId'),
      ('lead', 'convertedContactId'), ('lead', 'referredByContactId'), ('opportunity', 'primaryContactId'),
      ('quotation', 'contactId'), ('support_case', 'contactId'), ('training_participant', 'contactId'),
      ('web_form_submission', 'contactId'), ('app_user', 'contactId'), ('partner', 'contactId')
    ) as t(tbl, col) loop
      execute format('update %I set %I = $1 where %I = $2', v_pair.tbl, v_pair.col, v_pair.col) using p_survivor, v_loser;
      get diagnostics v_n = row_count;
      v_moved := v_moved + v_n;
    end loop;
    -- A partner link the survivor already has would clash; drop the loser's copy.
    delete from partner_contact pc where pc."contactId" = v_loser
      and exists (select 1 from partner_contact s where s."contactId" = p_survivor and s."partnerId" = pc."partnerId");
    update partner_contact set "contactId" = p_survivor where "contactId" = v_loser;
    get diagnostics v_n = row_count;
    v_moved := v_moved + v_n + merge_move_polymorphic('Contact', v_loser, p_survivor);
  end loop;

  insert into audit_history (id, "entityType", "entityId", "fieldName", "oldValue", "newValue", "changedById", source, "changedAt")
  select gen_random_uuid(), 'Contact', l, 'mergedIntoId', null, p_survivor::text, v_actor, 'manual', now() from unnest(p_losers) l
  union all
  select gen_random_uuid(), 'Contact', p_survivor, 'mergedFrom', null, array_to_string(p_losers, ','), v_actor, 'manual', now();

  insert into record_merge ("entityType", "survivorId", "mergedIds", "chosenValues", "recordsMoved", "mergedById")
  values ('Contact', p_survivor, p_losers, coalesce(p_values, '{}'::jsonb), v_moved, v_actor);

  return jsonb_build_object('survivorId', p_survivor, 'mergedCount', v_merged, 'recordsMoved', v_moved);
end $$;

revoke all on function merge_contacts(uuid, uuid[], jsonb) from public, anon;
grant execute on function merge_contacts(uuid, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create or replace function merge_accounts(p_survivor uuid, p_losers uuid[], p_values jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := app_current_user_id();
  v_all uuid[] := p_losers || p_survivor;
  v_loser uuid;
  v_moved integer := 0;
  v_n integer;
  v_merged integer;
  v_pair record;
  v_partners integer;
  v_cols text[] := array['name', 'industry', 'website', 'mainPhone', 'taxNumberNtn', 'description', 'employeeCount', 'annualRevenue', 'creditLimit', 'paymentTermsDays'];
  v_types text[] := array['varchar', 'varchar', 'varchar', 'varchar', 'varchar', 'text', 'integer', 'numeric', 'numeric', 'integer'];
begin
  if not (app_is_internal() and app_has_permission('account:write')) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if p_losers is null or array_length(p_losers, 1) is null then
    raise exception 'Choose at least one duplicate to merge in.';
  end if;
  if p_survivor = any(p_losers) then
    raise exception 'An account cannot be merged into itself.';
  end if;
  if (select count(*) from account where id = any(v_all) and "deletedAt" is null) <> array_length(v_all, 1) then
    raise exception 'One of those accounts no longer exists.';
  end if;
  perform 1 from account where id = any(v_all) for update;

  if exists (select 1 from partner where "accountId" = any(p_losers)) then
    raise exception 'An account being merged away is a partner. Keep the partner''s account as the one you keep.' using errcode = '23514';
  end if;
  select count(distinct "sourcePartnerId") into v_partners from account where id = any(v_all) and "sourcePartnerId" is not null;
  if v_partners > 1 then
    raise exception 'These accounts are credited to different partners, and credit decides who is paid commission. They cannot be merged.' using errcode = '23514';
  end if;
  if exists (select 1 from invoice where "accountId" = any(p_losers) and period_is_locked("invoiceDate"))
     or exists (select 1 from payment where "accountId" = any(p_losers) and period_is_locked("paymentDate"))
     or exists (select 1 from expense where "vendorAccountId" = any(p_losers) and period_is_locked("expenseDate")) then
    raise exception 'An account being merged away has invoices, payments or expenses in a closed month. Reopen that month first, or keep both.' using errcode = '23514';
  end if;

  update account set "mergedIntoId" = p_survivor, "mergedAt" = now(), "deletedAt" = now(), "deletedById" = v_actor
  where id = any(p_losers);
  get diagnostics v_merged = row_count;

  perform merge_apply_values('account', p_survivor, p_values, v_cols, v_types);
  -- The partner credit carries into an account that has none.
  update account s set
    "sourcePartnerId" = (select l."sourcePartnerId" from account l where l.id = any(p_losers) and l."sourcePartnerId" is not null limit 1),
    "sourcePartnerUserId" = (select l."sourcePartnerUserId" from account l where l.id = any(p_losers) and l."sourcePartnerId" is not null limit 1)
  where s.id = p_survivor and s."sourcePartnerId" is null
    and exists (select 1 from account l where l.id = any(p_losers) and l."sourcePartnerId" is not null);
  -- A survivor whose parent was merged away takes that account's parent.
  update account s set "parentAccountId" = nullif((select l."parentAccountId" from account l where l.id = s."parentAccountId"), p_survivor)
  where s.id = p_survivor and s."parentAccountId" = any(p_losers);
  update account set "updatedAt" = now() where id = p_survivor;

  foreach v_loser in array p_losers loop
    for v_pair in select * from (values
      ('account', 'parentAccountId'), ('company_setting', 'accountId'), ('contact', 'accountId'), ('contract', 'accountId'),
      ('expense', 'vendorAccountId'), ('invoice', 'accountId'), ('lead', 'convertedAccountId'), ('opportunity', 'accountId'),
      ('payment', 'accountId'), ('product', 'ownerAccountId'), ('project', 'accountId'), ('quotation', 'accountId'),
      ('support_case', 'accountId'), ('training', 'accountId'), ('vendor_bill', 'vendorAccountId'), ('vendor_payment', 'vendorAccountId')
    ) as t(tbl, col) loop
      -- id compared as text: company_setting's id is a boolean (one row only).
      execute format('update %I set %I = $1 where %I = $2 and id::text <> $1::text', v_pair.tbl, v_pair.col, v_pair.col) using p_survivor, v_loser;
      get diagnostics v_n = row_count;
      v_moved := v_moved + v_n;
    end loop;
    v_moved := v_moved + merge_move_polymorphic('Account', v_loser, p_survivor);
  end loop;

  insert into audit_history (id, "entityType", "entityId", "fieldName", "oldValue", "newValue", "changedById", source, "changedAt")
  select gen_random_uuid(), 'Account', l, 'mergedIntoId', null, p_survivor::text, v_actor, 'manual', now() from unnest(p_losers) l
  union all
  select gen_random_uuid(), 'Account', p_survivor, 'mergedFrom', null, array_to_string(p_losers, ','), v_actor, 'manual', now();

  insert into record_merge ("entityType", "survivorId", "mergedIds", "chosenValues", "recordsMoved", "mergedById")
  values ('Account', p_survivor, p_losers, coalesce(p_values, '{}'::jsonb), v_moved, v_actor);

  return jsonb_build_object('survivorId', p_survivor, 'mergedCount', v_merged, 'recordsMoved', v_moved);
end $$;

revoke all on function merge_accounts(uuid, uuid[], jsonb) from public, anon;
grant execute on function merge_accounts(uuid, uuid[], jsonb) to authenticated;
