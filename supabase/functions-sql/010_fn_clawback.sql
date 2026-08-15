-- Atomic commission clawback.
--
-- Ports the prisma.$transaction block in src/server/commission-engine.ts
-- (clawback()). supabase-js has no transaction API — each call is a separate
-- HTTP request — so a multi-step money operation must live in the database or
-- it is not atomic.
--
-- Without this, a failure between "create reversal" and "update original"
-- leaves a reversal with the original still ACCRUED: the ledger double-counts
-- and nothing raises an error.
--
-- SECURITY INVOKER (the default): the caller's RLS still applies, so a user
-- cannot claw back a commission they cannot see. Authorization for the action
-- itself (commission:write) stays in the application layer.

create or replace function claw_back_commission(
  p_record_id uuid,
  p_reason    text,
  p_actor_id  uuid
)
returns uuid
language plpgsql
as $$
declare
  v_orig        commission_record%rowtype;
  v_window_days integer;
  v_deadline    date;
  v_new_id      uuid;
  v_number      text;
begin
  -- Lock the row for the duration of the transaction so two concurrent
  -- clawbacks cannot both pass the status check. The Prisma version relied on
  -- transaction isolation for this; FOR UPDATE makes it explicit.
  select * into v_orig
  from commission_record
  where id = p_record_id
  for update;

  if not found then
    raise exception 'Commission record % not found', p_record_id
      using errcode = 'no_data_found';
  end if;

  if v_orig.status = 'CLAWED_BACK' then
    raise exception 'This commission has already been clawed back.'
      using errcode = 'raise_exception';
  end if;

  -- Clawback window, when the plan defines one.
  select cp."clawbackWindowDays" into v_window_days
  from commission_plan cp
  where cp.id = v_orig."planId";

  if v_window_days is not null then
    v_deadline := v_orig."earnedDate" + v_window_days;
    if current_date > v_deadline then
      raise exception 'Clawback window closed on % for %', v_deadline, v_orig."commissionNumber"
        using errcode = 'raise_exception';
    end if;
  end if;

  -- Must match SEQUENCES.COMMISSION in src/lib/numbering.ts, which is the
  -- NumberSequence.entityType value 'CommissionRecord'.
  v_number := next_sequence_number('CommissionRecord');
  v_new_id := gen_random_uuid();

  -- The reversal: every money column negated.
  insert into commission_record (
    id, "commissionNumber", "partnerId", "opportunityId", "opportunityPartnerId",
    "planId", status, basis, "basisAmount", "ratePercent", "commissionAmount",
    "withholdingTaxAmount", "netPayableAmount", "currencyCode", "earnedDate",
    "reversesRecordId", "calculationNotes", "createdAt", "updatedAt"
  ) values (
    v_new_id, v_number, v_orig."partnerId", v_orig."opportunityId",
    v_orig."opportunityPartnerId", v_orig."planId", 'CLAWED_BACK', v_orig.basis,
    -v_orig."basisAmount", v_orig."ratePercent", -v_orig."commissionAmount",
    -v_orig."withholdingTaxAmount", -v_orig."netPayableAmount",
    v_orig."currencyCode", current_date, v_orig.id,
    format('Clawback of %s: %s', v_orig."commissionNumber", p_reason),
    now(), now()
  );

  update commission_record
  set status = 'CLAWED_BACK',
      "rejectionReason" = p_reason,
      "updatedAt" = now()
  where id = v_orig.id;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", "changedAt"
  ) values (
    gen_random_uuid(), 'CommissionRecord', v_orig.id, 'status',
    v_orig.status::text, 'CLAWED_BACK', p_actor_id, now()
  );

  return v_new_id;
end;
$$;
