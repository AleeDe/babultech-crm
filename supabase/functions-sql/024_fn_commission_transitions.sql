-- Bulk commission status transitions.
--
-- Ports the submit / approve / reject transactions in src/server/commissions.ts.
-- Each moves a set of records to a new status and writes one audit row per
-- record. As separate HTTP calls the audit rows can be lost while the status
-- change persists, leaving a ledger whose history does not explain it.
--
-- Returns the number of records actually moved, so the caller can tell the user
-- how many of their selection qualified.

/**
 * Move records to a new status, but only from the statuses given in
 * p_from_statuses. Records in any other state are left alone.
 */
create or replace function transition_commissions(
  p_record_ids    uuid[],
  p_from_statuses text[],
  p_to_status     text,
  p_actor_id      uuid,
  p_reason        text default null
)
returns integer
language plpgsql
as $$
declare
  v_rec   record;
  v_count integer := 0;
begin
  for v_rec in
    select id, status::text as status
    from commission_record
    where id = any(p_record_ids)
      and status::text = any(p_from_statuses)
      and "deletedAt" is null
    for update
  loop
    update commission_record
    set status = p_to_status::"CommissionStatus",
        "rejectionReason" = coalesce(p_reason, "rejectionReason"),
        "updatedAt" = now()
    where id = v_rec.id;

    insert into audit_history (
      id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
      "changedById", source, "changedAt"
    ) values (
      gen_random_uuid(), 'CommissionRecord', v_rec.id, 'status', v_rec.status,
      p_to_status, p_actor_id, 'UI', now()
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

/**
 * Approval is not a single target status: a record whose payoutDelayDays has
 * not elapsed becomes APPROVED, one that has become PAYABLE. Deciding that in
 * SQL keeps the comparison in the database, where payableFromDate is a real
 * date — in JavaScript it arrives as a string and `string <= Date` is always
 * false, which would mark every delayed commission immediately payable.
 */
create or replace function approve_commissions(
  p_record_ids uuid[],
  p_actor_id   uuid
)
returns integer
language plpgsql
as $$
declare
  v_rec    record;
  v_count  integer := 0;
  v_target text;
begin
  for v_rec in
    select id, status::text as status, "payableFromDate"
    from commission_record
    where id = any(p_record_ids)
      and status::text in ('ACCRUED', 'PENDING_APPROVAL')
      and "deletedAt" is null
    for update
  loop
    v_target := case
      when v_rec."payableFromDate" is null or v_rec."payableFromDate" <= current_date
        then 'PAYABLE'
      else 'APPROVED'
    end;

    update commission_record
    set status = v_target::"CommissionStatus",
        "approvedById" = p_actor_id,
        "approvedAt" = now(),
        "updatedAt" = now()
    where id = v_rec.id;

    insert into audit_history (
      id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
      "changedById", source, "changedAt"
    ) values (
      gen_random_uuid(), 'CommissionRecord', v_rec.id, 'status', v_rec.status,
      v_target, p_actor_id, 'UI', now()
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

/**
 * Batch approved commissions into a payout.
 *
 * Creates the payout, then stamps its id onto every record in the batch. Split
 * across HTTP calls, a failure between the two leaves a payout whose total
 * covers records that are still unattached — they would be batched again into
 * a second payout and paid twice.
 *
 * Validation is inside the lock: the caller's view of "approved and unpaid"
 * must not change between the check and the write.
 */
create or replace function create_commission_payout(
  p_partner_id  uuid,
  p_record_ids  uuid[],
  p_period_start date,
  p_period_end   date,
  p_notes        text
)
returns jsonb
language plpgsql
as $$
declare
  v_count      integer;
  v_currencies text[];
  v_gross      numeric(18,2);
  v_wht        numeric(18,2);
  v_net        numeric(18,2);
  v_currency   text;
  v_id         uuid := gen_random_uuid();
  v_number     text;
begin
  create temporary table if not exists _payout_batch (id uuid) on commit drop;
  delete from _payout_batch;

  insert into _payout_batch (id)
  select id from commission_record
  where id = any(p_record_ids)
    and "partnerId" = p_partner_id
    and status::text in ('APPROVED', 'PAYABLE')
    and "payoutId" is null
    and "deletedAt" is null
  for update;

  select count(*) into v_count from _payout_batch;

  if v_count = 0 then
    raise exception 'None of the selected commissions are approved and unpaid for this partner.'
      using errcode = 'raise_exception';
  end if;

  if v_count <> array_length(p_record_ids, 1) then
    raise exception '% of the selected commissions are not payable (wrong status, already in a payout, or belong to another partner).',
      array_length(p_record_ids, 1) - v_count
      using errcode = 'raise_exception';
  end if;

  select array_agg(distinct cr."currencyCode"),
         sum(cr."commissionAmount"),
         sum(cr."withholdingTaxAmount"),
         sum(cr."netPayableAmount")
    into v_currencies, v_gross, v_wht, v_net
  from commission_record cr
  join _payout_batch b on b.id = cr.id;

  if array_length(v_currencies, 1) > 1 then
    raise exception 'Cannot batch commissions in % into one payout. Create a separate payout per currency.',
      array_to_string(v_currencies, ' and ')
      using errcode = 'raise_exception';
  end if;

  v_currency := v_currencies[1];
  v_number := next_sequence_number('CommissionPayout');

  insert into commission_payout (
    id, "payoutNumber", "partnerId", status, "periodStart", "periodEnd",
    "grossAmount", "withholdingTaxAmount", "netAmount", "currencyCode", notes,
    "createdAt", "updatedAt"
  ) values (
    v_id, v_number, p_partner_id, 'DRAFT', p_period_start, p_period_end,
    v_gross, v_wht, v_net, v_currency, p_notes, now(), now()
  );

  update commission_record
  set "payoutId" = v_id, "updatedAt" = now()
  where id in (select id from _payout_batch);

  return jsonb_build_object('id', v_id, 'payoutNumber', v_number);
end;
$$;

/**
 * Records the money leaving: payout PAID, its records PAID, and an outgoing
 * FinancialTransaction (spec §13 — the cash register should be system-created).
 *
 * All four writes together. A payout marked paid whose records stayed unpaid
 * would show the partner as owed money that has already left the bank.
 */
create or replace function mark_payout_paid(
  p_payout_id      uuid,
  p_payment_date   date,
  p_payment_method text,
  p_bank_account_id uuid,
  p_reference      text,
  p_actor_id       uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_payout    commission_payout%rowtype;
  v_partner   text;
  v_txn_number text;
begin
  select * into v_payout from commission_payout where id = p_payout_id for update;

  if not found then
    raise exception 'Payout % not found', p_payout_id using errcode = 'no_data_found';
  end if;

  if v_payout.status::text <> 'APPROVED' then
    raise exception 'Payout % must be approved before it can be paid.', v_payout."payoutNumber"
      using errcode = 'raise_exception';
  end if;

  select "displayName" into v_partner from partner where id = v_payout."partnerId";

  update commission_payout
  set status = 'PAID',
      "paymentDate" = p_payment_date,
      "paymentMethod" = p_payment_method::"PaymentMethod",
      "bankAccountId" = p_bank_account_id,
      "referenceNumber" = p_reference,
      "updatedAt" = now()
  where id = p_payout_id;

  update commission_record
  set status = 'PAID', "paidAt" = p_payment_date, "updatedAt" = now()
  where "payoutId" = p_payout_id;

  v_txn_number := next_sequence_number('FinancialTransaction');

  insert into financial_transaction (
    id, "transactionNumber", "transactionDate", "transactionType", direction,
    amount, "currencyCode", "bankAccountId", "sourceEntityType",
    "sourceEntityId", status, reference, description, "createdAt", "updatedAt"
  ) values (
    gen_random_uuid(), v_txn_number, p_payment_date, 'COMMISSION_PAYOUT',
    'OUTGOING', v_payout."netAmount", v_payout."currencyCode", p_bank_account_id,
    'CommissionPayout', p_payout_id, 'POSTED',
    coalesce(p_reference, v_payout."payoutNumber"),
    format('Partner commission payout %s to %s', v_payout."payoutNumber", v_partner),
    now(), now()
  );

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'CommissionPayout', p_payout_id, 'status', 'APPROVED',
    'PAID', p_actor_id, 'UI', now()
  );

  return jsonb_build_object('payoutNumber', v_payout."payoutNumber");
end;
$$;
