-- Reuse the existing activity ledger and lead follow-up timestamp atomically.
-- No new lead status, no duplicate contact store, no outbound calls are made.
alter table activity add column if not exists "followUpAt" timestamptz;
create or replace function log_lead_call(
  p_request_id uuid, p_lead_id uuid, p_outcome text, p_notes text, p_follow_up timestamptz
) returns jsonb language plpgsql security invoker set search_path=public set timezone='UTC' as $$
declare v_lead lead%rowtype; v_existing activity%rowtype; v_id uuid;
begin
  if not coalesce(app_is_internal() and app_current_scope() is not null
    and app_has_permission('lead:read') and app_has_permission('lead:write'),false) then
    raise exception 'Lead access required.' using errcode='42501';
  end if;
  select * into v_lead from lead where id=p_lead_id and "ownerUserId"=app_current_user_id()
    and "deletedAt" is null for update;
  if not found then raise exception 'Lead is not assigned to you.' using errcode='42501'; end if;
  -- The lead lock serializes concurrent retries. The caller retains one UUID
  -- until a save succeeds, so a lost response cannot create two call attempts.
  select * into v_existing from activity where id=p_request_id;
  if found then
    if v_existing."ownerUserId"=app_current_user_id() and v_existing."relatedEntityType"='Lead'
      and v_existing."relatedEntityId"=p_lead_id and v_existing."activityType"='CALL'
      and v_existing.outcome=p_outcome and v_existing.description=trim(p_notes)
      and v_existing."followUpAt"=p_follow_up then
      return jsonb_build_object('id',v_existing.id);
    end if;
    raise exception 'Request ID already used.' using errcode='23505';
  end if;
  if p_request_id is null or p_outcome is null or p_outcome not in ('NO_ANSWER','CONNECTED','CALLBACK_REQUESTED','WRONG_NUMBER')
    or p_notes is null or length(trim(p_notes)) not between 1 and 4000
    or p_follow_up is null or p_follow_up<=now()
    or v_lead.status in ('DISQUALIFIED','CONVERTED') or v_lead."convertedAt" is not null then
    raise exception 'An open lead, valid outcome, notes and future follow-up are required.' using errcode='22023';
  end if;
  insert into activity(id,"activityType",subject,description,"ownerUserId","relatedEntityType","relatedEntityId",
    "campaignId",status,outcome,"completedAt","followUpAt","updatedAt")
    values(p_request_id,'CALL','Call: '||left(v_lead."firstName"||' '||v_lead."lastName",240),trim(p_notes),
      app_current_user_id(),'Lead',p_lead_id,v_lead."campaignId",'COMPLETED',p_outcome,now(),p_follow_up,now()) returning id into v_id;
  update lead set "nextFollowUpAt"=p_follow_up,"updatedAt"=now() where id=p_lead_id;
  insert into audit_history("entityType","entityId","fieldName","oldValue","newValue","changedById",source,"changedAt")
    values('Lead',p_lead_id,'nextFollowUpAt',v_lead."nextFollowUpAt"::text,p_follow_up::text,app_current_user_id(),'UI',now());
  return jsonb_build_object('id',v_id);
end $$;
revoke all on function log_lead_call(uuid,uuid,text,text,timestamptz) from public, anon;
grant execute on function log_lead_call(uuid,uuid,text,text,timestamptz) to authenticated;
create index if not exists lead_call_queue_idx on lead("ownerUserId","nextFollowUpAt",id)
  where "deletedAt" is null and "convertedAt" is null and status not in ('CONVERTED','DISQUALIFIED');
