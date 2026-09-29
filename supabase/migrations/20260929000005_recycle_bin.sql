-- The recycle bin.
--
-- Leads, accounts, contacts, deals, cases and campaigns can now be deleted
-- from their pages. A delete hides the record rather than erasing it: it
-- stays in the recycle bin for 90 days, where it can be restored, and is then
-- erased by the nightly clean-up. An administrator can erase one sooner.
--
-- A delete is refused while the record carries money or history that must
-- not disappear with it - an account with invoices or payments, a won deal, a
-- deal with commission - or while other live records still hang off it. The
-- reasons are worked out here, in one place, so the page and the check agree.
--
-- Finance records, expenses and users are never deleted this way.
--
-- deletedById says who deleted it, and marks what the recycle bin holds:
-- records hidden by older features (a removed note, a merged lead) keep a
-- null here and are not listed or erased.

alter table lead add column if not exists "deletedById" uuid references app_user(id) on delete set null;
alter table account add column if not exists "deletedById" uuid references app_user(id) on delete set null;
alter table contact add column if not exists "deletedById" uuid references app_user(id) on delete set null;
alter table opportunity add column if not exists "deletedById" uuid references app_user(id) on delete set null;
alter table support_case add column if not exists "deletedById" uuid references app_user(id) on delete set null;
alter table campaign add column if not exists "deletedById" uuid references app_user(id) on delete set null;

create index if not exists lead_recycle_idx on lead ("deletedAt") where "deletedById" is not null;
create index if not exists account_recycle_idx on account ("deletedAt") where "deletedById" is not null;
create index if not exists contact_recycle_idx on contact ("deletedAt") where "deletedById" is not null;
create index if not exists opportunity_recycle_idx on opportunity ("deletedAt") where "deletedById" is not null;
create index if not exists support_case_recycle_idx on support_case ("deletedAt") where "deletedById" is not null;
create index if not exists campaign_recycle_idx on campaign ("deletedAt") where "deletedById" is not null;

-- Why a record cannot be deleted, or null if it can.
create or replace function recycle_blocker(p_entity_type text, p_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_entity_type = 'Lead' then
    if exists (select 1 from lead where id = p_id and "convertedAt" is not null) then
      return 'It has been converted. The lead stays as the record of where the customer came from.';
    end if;

  elsif p_entity_type = 'Account' then
    if exists (select 1 from invoice where "accountId" = p_id and "deletedAt" is null) then
      return 'It has invoices. Customers with billing history are kept.';
    end if;
    if exists (select 1 from payment where "accountId" = p_id and "deletedAt" is null) then
      return 'It has payments. Customers with billing history are kept.';
    end if;
    select count(*) into v_count from opportunity where "accountId" = p_id and "deletedAt" is null;
    if v_count > 0 then
      return format('It has %s deal%s. Delete or move them first.', v_count, case when v_count = 1 then '' else 's' end);
    end if;
    if exists (select 1 from project where "accountId" = p_id and "deletedAt" is null) then
      return 'It has projects.';
    end if;
    if exists (select 1 from contract where "accountId" = p_id and "deletedAt" is null) then
      return 'It has contracts.';
    end if;
    if exists (select 1 from support_case where "accountId" = p_id and "deletedAt" is null) then
      return 'It has support cases. Delete them first.';
    end if;
    if exists (select 1 from partner where "accountId" = p_id and "deletedAt" is null) then
      return 'It is a partner''s company.';
    end if;
    if exists (select 1 from app_user u join contact c on c.id = u."contactId"
                where c."accountId" = p_id and u."deletedAt" is null) then
      return 'Someone at it has a portal login. Remove their access first.';
    end if;

  elsif p_entity_type = 'Contact' then
    if exists (select 1 from app_user where "contactId" = p_id and "deletedAt" is null) then
      return 'They have a portal login. Remove their access first.';
    end if;
    if exists (select 1 from support_case where "contactId" = p_id and "deletedAt" is null) then
      return 'They have support cases.';
    end if;
    if exists (select 1 from opportunity where "primaryContactId" = p_id and "deletedAt" is null
                and stage not in ('CLOSED_WON', 'CLOSED_LOST')) then
      return 'They are the main contact on an open deal. Change the deal''s contact first.';
    end if;

  elsif p_entity_type = 'Opportunity' then
    if exists (select 1 from opportunity where id = p_id and stage = 'CLOSED_WON') then
      return 'It is won. Won deals are kept.';
    end if;
    if exists (select 1 from partner_commission where "opportunityId" = p_id) then
      return 'It carries partner commission.';
    end if;
    if exists (select 1 from project where "opportunityId" = p_id and "deletedAt" is null) then
      return 'It has a project.';
    end if;
    if exists (select 1 from quotation where "opportunityId" = p_id and "deletedAt" is null and status in ('SENT', 'ACCEPTED')) then
      return 'A quote on it has been sent to the customer.';
    end if;
    if exists (select 1 from contract where "opportunityId" = p_id and "deletedAt" is null) then
      return 'It has a contract.';
    end if;

  elsif p_entity_type = 'SupportCase' then
    null; -- A case can always be deleted; its comments go with it.

  elsif p_entity_type = 'Campaign' then
    if exists (select 1 from campaign where "parentCampaignId" = p_id and "deletedAt" is null) then
      return 'It has child campaigns.';
    end if;
    if exists (select 1 from lead where "campaignId" = p_id and "deletedAt" is null) then
      return 'Leads came from it. Campaigns with results are kept.';
    end if;
    if exists (select 1 from opportunity where "campaignId" = p_id and "deletedAt" is null) then
      return 'Deals came from it. Campaigns with results are kept.';
    end if;
    if exists (select 1 from campaign_member where "campaignId" = p_id and "deletedAt" is null) then
      return 'It has members. Remove them first.';
    end if;

  else
    return 'That kind of record cannot be deleted here.';
  end if;

  return null;
end $$;

revoke all on function recycle_blocker(text, uuid) from public, anon, authenticated;
grant execute on function recycle_blocker(text, uuid) to service_role;

create or replace function recycle_table(p_entity_type text)
returns text language sql immutable as $$
  select case p_entity_type
    when 'Lead' then 'lead' when 'Account' then 'account' when 'Contact' then 'contact'
    when 'Opportunity' then 'opportunity' when 'SupportCase' then 'support_case' when 'Campaign' then 'campaign'
  end;
$$;

-- Erases one record from the recycle bin, with what belongs only to it. A
-- record something else still points at is refused with the reason.
create or replace function recycle_erase(p_entity_type text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text := recycle_table(p_entity_type);
  v_in_bin boolean;
begin
  if v_table is null then
    raise exception 'That kind of record cannot be erased here.' using errcode = '22023';
  end if;
  execute format('select exists (select 1 from %I where id = $1 and "deletedById" is not null)', v_table)
    into v_in_bin using p_id;
  if not v_in_bin then
    raise exception 'Only a record in the recycle bin can be erased.' using errcode = '22023';
  end if;

  if v_table = 'support_case' then
    delete from case_comment where "caseId" = p_id;
  elsif v_table = 'opportunity' then
    delete from quote_line where "quotationId" in (select id from quotation where "opportunityId" = p_id);
    delete from quotation where "opportunityId" = p_id;
    delete from opportunity_product where "opportunityId" = p_id;
  elsif v_table = 'account' then
    delete from contact where "accountId" = p_id and "deletedById" is not null;
  end if;

  begin
    execute format('delete from %I where id = $1', v_table) using p_id;
  exception when foreign_key_violation then
    raise exception 'Other records still point at it, so it has been kept: %', sqlerrm using errcode = '23503';
  end;
end $$;

revoke all on function recycle_erase(text, uuid) from public, anon, authenticated;
grant execute on function recycle_erase(text, uuid) to service_role;

-- The nightly erase: what has sat in the recycle bin for 90 days. One at a
-- time, so a record something still points at is left rather than stopping
-- the rest.
create or replace function recycle_purge()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_id uuid;
  v_count integer := 0;
begin
  foreach v_type in array array['SupportCase', 'Opportunity', 'Contact', 'Lead', 'Campaign', 'Account'] loop
    for v_id in execute format(
      'select id from %I where "deletedById" is not null and "deletedAt" < now() - interval ''90 days''', recycle_table(v_type))
    loop
      begin
        perform recycle_erase(v_type, v_id);
        v_count := v_count + 1;
      exception when others then
        raise warning 'recycle_purge: % % kept: %', v_type, v_id, sqlerrm;
      end;
    end loop;
  end loop;
  return v_count;
end $$;

revoke all on function recycle_purge() from public, anon, authenticated;
grant execute on function recycle_purge() to service_role;

-- 03:30 in Karachi.
select cron.schedule('babultech-recycle-purge', '30 22 * * *', 'select public.recycle_purge()');

notify pgrst, 'reload schema';
