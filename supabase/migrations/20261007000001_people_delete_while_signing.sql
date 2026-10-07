-- A person can be deleted while their contract is still being signed.
--
-- 20261007000000 refused a delete when the hire had signed but the company had
-- not yet. Such a contract is not in force, so it no longer holds a delete back;
-- the delete stops its signing link as before.

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

  elsif p_entity_type = 'Quotation' then
    if exists (select 1 from quotation where id = p_id and status::text = 'ACCEPTED') then
      return 'It was accepted. It is the record of what the customer agreed to.';
    end if;

  elsif p_entity_type = 'Contract' then
    if exists (select 1 from contract where id = p_id and status::text = 'ACTIVE') then
      return 'It is active. Terminate or expire it first.';
    end if;
    if exists (select 1 from project where "contractId" = p_id and "deletedAt" is null
                and status::text not in ('COMPLETED', 'CANCELLED')) then
      return 'Live projects run under it.';
    end if;
    if exists (select 1 from invoice where "contractId" = p_id and "deletedAt" is null and status::text <> 'CANCELLED') then
      return 'It has invoices.';
    end if;

  elsif p_entity_type = 'Project' then
    select count(*) into v_count from invoice where "projectId" = p_id and "deletedAt" is null and status::text <> 'CANCELLED';
    if v_count > 0 then
      return format('%s invoice%s were raised on it. Set its status to Cancelled instead.', v_count, case when v_count = 1 then '' else 's' end);
    end if;

  elsif p_entity_type = 'Product' then
    if exists (select 1 from opportunity_product op join opportunity o on o.id = op."opportunityId"
                where op."productId" = p_id and o."deletedAt" is null) then
      return 'It is on deals. Switch it off instead, so it is no longer offered.';
    end if;
    if exists (select 1 from quote_line ql join quotation q on q.id = ql."quotationId"
                where ql."productId" = p_id and q."deletedAt" is null) then
      return 'It is on quotes. Switch it off instead, so it is no longer offered.';
    end if;

  elsif p_entity_type = 'PriceBook' then
    if exists (select 1 from opportunity where "priceBookId" = p_id and "deletedAt" is null) then
      return 'Deals are priced from it.';
    end if;

  elsif p_entity_type = 'Partner' then
    if exists (select 1 from opportunity where "sourcePartnerId" = p_id and "deletedAt" is null) then
      return 'Deals are credited to it. Partners with business are kept; set it to inactive instead.';
    end if;
    if exists (select 1 from partner_commission where "partnerId" = p_id) then
      return 'It has commission records.';
    end if;
    if exists (select 1 from app_user where "partnerId" = p_id and "deletedAt" is null) then
      return 'It has portal logins. Remove their access first.';
    end if;

  elsif p_entity_type = 'KnowledgeArticle' then
    null; -- An article can always be deleted.

  elsif p_entity_type = 'CampaignMember' then
    null; -- A lead made from the member keeps everything it needs.

  elsif p_entity_type = 'Activity' then
    null; -- A logged call, meeting or task can always be deleted.

  elsif p_entity_type = 'Invoice' then
    if exists (select 1 from invoice where id = p_id and status::text <> 'DRAFT') then
      return 'Only a draft invoice can be deleted. Void it, or raise a credit note, instead.';
    end if;
    if exists (select 1 from invoice where id = p_id and period_is_locked("invoiceDate")) then
      return 'Its month is closed.';
    end if;

  elsif p_entity_type = 'VendorBill' then
    if exists (select 1 from vendor_bill where id = p_id and status::text <> 'DRAFT') then
      return 'Only a draft supplier bill can be deleted. Cancel it instead.';
    end if;

  elsif p_entity_type = 'Payment' then
    if exists (select 1 from payment_allocation where "paymentId" = p_id) then
      return 'It is allocated to invoices. Remove the allocations first.';
    end if;
    if exists (select 1 from payment where id = p_id and period_is_locked("paymentDate")) then
      return 'Its month is closed.';
    end if;

  elsif p_entity_type = 'Expense' then
    if exists (select 1 from expense where id = p_id and period_is_locked("expenseDate")) then
      return 'Its month is closed.';
    end if;

  elsif p_entity_type = 'StaffProfile' then
    -- Someone whose contract is in force (signed by both sides, running, or
    -- leaving on a later day) is ended first. A contract still being signed
    -- does not hold a delete back.
    if exists (select 1 from employment_contract c where c."staffId" = p_id
                and (c.status in ('ACTIVE', 'SIGNED')
                     or (c.status in ('TERMINATED', 'RESIGNED') and c."lastWorkingDay" >= (now() at time zone 'Asia/Karachi')::date))) then
      return 'Their contract has been signed by both sides or is running. End it first (terminate or record a resignation), or cancel it if it has not started.';
    end if;

  else
    return 'That kind of record cannot be deleted here.';
  end if;

  return null;
end $$;

revoke all on function recycle_blocker(text, uuid) from public, anon, authenticated;
grant execute on function recycle_blocker(text, uuid) to service_role;
