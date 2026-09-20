-- Let an administrator add to or take away from what a partner has earned.
--
-- Commission is otherwise calculated: the engine reads the plan, applies the
-- tier and writes the record. That is right almost always, and wrong exactly
-- when a human has agreed something the plan does not describe - a goodwill
-- top-up on a hard-won deal, a correction after a rate was mis-set, a deduction
-- for work the partner did not in the end do.
--
-- Those cases are handled by adding a second record rather than editing the
-- first. An edited commission loses the history of what was originally earned
-- and why; a separate adjustment row keeps both, and the ledger still sums to
-- the right number.
--
-- An adjustment is NOT a clawback. A clawback reverses one accrual in full and
-- is driven by the engine (see clawback() in commission-engine.ts). An
-- adjustment is a free amount, positive or negative, that a person decided on
-- and must justify in writing.

alter table commission_record
  -- Distinguishes a hand-made row from an engine-made one, so the ledger can
  -- label it and reports can exclude it from rate analysis - an adjustment has
  -- no meaningful rate, and averaging it in would misstate what the plan pays.
  add column if not exists "isAdjustment" boolean not null default false,
  -- The record this adjustment relates to. Nullable: an adjustment may be made
  -- against a deal that never accrued anything at all.
  add column if not exists "adjustsRecordId" uuid
    references commission_record (id) on delete set null,
  -- Who decided, kept beside the reason. calculationNotes carries the reason
  -- itself, which is how the existing screens already read an explanation.
  add column if not exists "adjustedById" uuid
    references app_user (id) on delete set null;

create index if not exists "commission_record_adjustsRecordId_idx"
  on commission_record ("adjustsRecordId");

-- The accrual guard does not apply here.
--
-- accrue_commission() refuses a second record for the same (link, invoice,
-- payment), which is what stops a retry double-paying. An adjustment is
-- deliberately a second record on the same link, so it needs its own function
-- rather than a flag on that one. The unique index tolerates this already:
-- Postgres treats NULL invoiceId/paymentId as distinct, so many adjustment
-- rows may sit beside one accrual.
create or replace function adjust_commission(
  p_partner_id       uuid,
  p_opportunity_id   uuid,
  p_adjusts_record_id uuid,
  p_amount           numeric,
  p_currency         text,
  p_reason           text,
  p_actor_id         uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid := gen_random_uuid();
  v_number text;
  v_link   uuid;
begin
  if p_amount = 0 then
    raise exception 'An adjustment of zero would change nothing.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'An adjustment needs a reason.';
  end if;

  -- Carry the deal link across when there is one, so the adjustment appears on
  -- the same deal in the partner's portal as the accrual it corrects.
  select id into v_link
  from opportunity_partner
  where "opportunityId" = p_opportunity_id
    and "partnerId" = p_partner_id
  limit 1;

  v_number := next_sequence_number('CommissionRecord');

  insert into commission_record (
    id, "commissionNumber", "partnerId", "opportunityId",
    "opportunityPartnerId", status, basis, "basisAmount", "ratePercent",
    "commissionAmount", "withholdingTaxAmount", "netPayableAmount",
    "currencyCode", "earnedDate", "payableFromDate", "calculationNotes",
    "isAdjustment", "adjustsRecordId", "adjustedById", "createdAt", "updatedAt"
  ) values (
    v_id, v_number, p_partner_id, p_opportunity_id,
    v_link, 'ACCRUED', 'OPPORTUNITY_AMOUNT', 0, null,
    p_amount, 0, p_amount,
    p_currency, current_date, current_date, p_reason,
    true, p_adjusts_record_id, p_actor_id, now(), now()
  );

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'CommissionRecord', v_id, 'adjustment', null,
    p_amount::text || ' - ' || p_reason, p_actor_id, 'manual', now()
  );

  return jsonb_build_object('id', v_id, 'commissionNumber', v_number);
end;
$$;

revoke all on function adjust_commission(uuid, uuid, uuid, numeric, text, text, uuid) from public;
grant execute on function adjust_commission(uuid, uuid, uuid, numeric, text, text, uuid) to authenticated;
