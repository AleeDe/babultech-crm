-- Atomic commission accrual write.
--
-- The *calculation* stays in TypeScript (src/server/commission-engine.ts):
-- tier resolution, plan snapshotting and rounding are intricate business rules
-- that belong with the tests that cover them, not in PL/pgSQL.
--
-- What must be atomic is the write: allocate the commission number, insert the
-- record, and write its audit row. Split across HTTP calls, a failure between
-- them either burns a number or leaves a commission with no history — and the
-- duplicate guard stops working, so a retry double-pays the partner.
--
-- The uniqueness check is inside the function and holds a lock, so two
-- concurrent accruals for the same (link, invoice, payment) cannot both insert.

create or replace function accrue_commission(
  p_partner_id             uuid,
  p_opportunity_id         uuid,
  p_opportunity_partner_id uuid,
  p_plan_id                uuid,
  p_invoice_id             uuid,
  p_payment_id             uuid,
  p_basis                  text,
  p_basis_amount           numeric,
  p_rate_percent           numeric,
  p_commission_amount      numeric,
  p_withholding_amount     numeric,
  p_net_payable            numeric,
  p_currency               text,
  p_earned_date            date,
  p_payable_from           date,
  p_notes                  text,
  p_actor_id               uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_id     uuid := gen_random_uuid();
  v_number text;
  v_exists uuid;
begin
  -- One commission per partner per deal per triggering document. Matches the
  -- @@unique([opportunityPartnerId, invoiceId, paymentId]) in the schema; done
  -- here as well so the caller gets a clean no-op rather than a constraint
  -- violation on a retry.
  select id into v_exists
  from commission_record
  where "opportunityPartnerId" = p_opportunity_partner_id
    and "invoiceId" is not distinct from p_invoice_id
    and "paymentId" is not distinct from p_payment_id
  limit 1
  for update;

  if v_exists is not null then
    return null;  -- already accrued; caller skips
  end if;

  v_number := next_sequence_number('CommissionRecord');

  insert into commission_record (
    id, "commissionNumber", "partnerId", "opportunityId",
    "opportunityPartnerId", "planId", "invoiceId", "paymentId", status, basis,
    "basisAmount", "ratePercent", "commissionAmount", "withholdingTaxAmount",
    "netPayableAmount", "currencyCode", "earnedDate", "payableFromDate",
    "calculationNotes", "createdAt", "updatedAt"
  ) values (
    v_id, v_number, p_partner_id, p_opportunity_id, p_opportunity_partner_id,
    p_plan_id, p_invoice_id, p_payment_id, 'ACCRUED', p_basis::"CommissionBasis",
    p_basis_amount, p_rate_percent, p_commission_amount, p_withholding_amount,
    p_net_payable, p_currency, p_earned_date, p_payable_from, p_notes,
    now(), now()
  );

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'CommissionRecord', v_id, 'status', null, 'ACCRUED',
    p_actor_id, 'automation', now()
  );

  return jsonb_build_object('id', v_id, 'commissionNumber', v_number);
end;
$$;
