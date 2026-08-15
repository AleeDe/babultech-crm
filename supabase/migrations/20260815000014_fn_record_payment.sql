-- Atomic payment recording with allocations.
--
-- Ports the prisma.$transaction in src/server/billing.ts (recordPayment).
-- Creates the payment, validates and writes each allocation, and recalculates
-- every touched invoice — all or nothing.
--
-- The validation lives here rather than in the caller because it must hold
-- against the row as locked. Checking "would this overpay?" in the application
-- and then writing in a separate request is a race: two concurrent payments can
-- both pass the check and jointly overpay the invoice.
--
-- p_allocations is [{ "invoiceId": uuid, "amount": numeric }, ...].

create or replace function record_payment(
  p_payload     jsonb,
  p_allocations jsonb,
  p_actor_id    uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_payment    jsonb;
  v_payment_id uuid;
  v_account_id uuid := (p_payload->>'accountId')::uuid;
  v_currency   text := p_payload->>'currencyCode';
  v_alloc      jsonb;
  v_invoice    record;
  v_amount     numeric(18,2);
begin
  v_payment := create_record('payment', p_payload, 'paymentNumber', 'Payment');
  v_payment_id := (v_payment->>'id')::uuid;

  for v_alloc in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb))
  loop
    v_amount := (v_alloc->>'amount')::numeric;

    -- FOR UPDATE: the outstanding figure this check reads must not move before
    -- the allocation is written.
    select "accountId", "currencyCode", "outstandingAmount", "invoiceNumber",
           status::text
      into v_invoice
    from invoice
    where id = (v_alloc->>'invoiceId')::uuid
    for update;

    if not found then
      raise exception 'Invoice % not found', v_alloc->>'invoiceId'
        using errcode = 'no_data_found';
    end if;

    if v_invoice."accountId" <> v_account_id then
      raise exception '% belongs to a different customer.', v_invoice."invoiceNumber"
        using errcode = 'raise_exception';
    end if;

    if v_invoice."currencyCode" <> v_currency then
      raise exception '% is in % but the payment is in %. Cross-currency application is not supported.',
        v_invoice."invoiceNumber", v_invoice."currencyCode", v_currency
        using errcode = 'raise_exception';
    end if;

    if v_invoice.status in ('DRAFT', 'CANCELLED') then
      raise exception '% has not been issued yet.', v_invoice."invoiceNumber"
        using errcode = 'raise_exception';
    end if;

    if v_amount > v_invoice."outstandingAmount" + 0.005 then
      raise exception 'Applying % to % would overpay it — only % is outstanding.',
        v_amount, v_invoice."invoiceNumber", v_invoice."outstandingAmount"
        using errcode = 'raise_exception';
    end if;

    -- payment_allocation carries allocatedAt only — no createdAt/updatedAt.
    insert into payment_allocation (
      id, "paymentId", "invoiceId", "allocatedAmount", "allocatedById",
      "allocatedAt"
    ) values (
      gen_random_uuid(), v_payment_id, (v_alloc->>'invoiceId')::uuid,
      v_amount, p_actor_id, now()
    );

    perform recalculate_invoice((v_alloc->>'invoiceId')::uuid);
  end loop;

  return v_payment;
end;
$$;

/**
 * Applies unallocated cash from an existing payment against one invoice.
 * Ports allocatePayment().
 */
create or replace function allocate_payment(
  p_payment_id uuid,
  p_invoice_id uuid,
  p_amount     numeric,
  p_actor_id   uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_unallocated numeric(18,2);
  v_invoice     record;
begin
  select "unallocatedAmount" into v_unallocated
  from payment where id = p_payment_id for update;

  if not found then
    raise exception 'Payment % not found', p_payment_id using errcode = 'no_data_found';
  end if;

  if p_amount > v_unallocated + 0.005 then
    raise exception 'Only % is unapplied on this payment.', v_unallocated
      using errcode = 'raise_exception';
  end if;

  select "outstandingAmount", "invoiceNumber" into v_invoice
  from invoice where id = p_invoice_id for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id using errcode = 'no_data_found';
  end if;

  if p_amount > v_invoice."outstandingAmount" + 0.005 then
    raise exception 'Applying % to % would overpay it — only % is outstanding.',
      p_amount, v_invoice."invoiceNumber", v_invoice."outstandingAmount"
      using errcode = 'raise_exception';
  end if;

  insert into payment_allocation (
    id, "paymentId", "invoiceId", "allocatedAmount", "allocatedById",
    "allocatedAt"
  ) values (
    gen_random_uuid(), p_payment_id, p_invoice_id, p_amount, p_actor_id, now()
  );

  update payment
  set "unallocatedAmount" = "unallocatedAmount" - p_amount,
      "updatedAt" = now()
  where id = p_payment_id;

  return recalculate_invoice(p_invoice_id);
end;
$$;
