-- Invoice balance recalculation.
--
-- Ports recalculateInvoice() from src/server/billing.ts. That function is the
-- single place paidAmount and outstandingAmount are ever written, which is what
-- makes the AR ageing view trustworthy — so it has to be atomic with whatever
-- moved the balance.
--
-- Only CLEARED payments count. A cheque that has not cleared is not payment,
-- and counting it would show an invoice as paid while the money is still in the
-- air.

create or replace function recalculate_invoice(p_invoice_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_total       numeric(18,2);
  v_write_off   numeric(18,2);
  v_paid        numeric(18,2);
  v_outstanding numeric(18,2);
  v_status      text;
  v_due         date;
begin
  select "totalAmount", coalesce("writeOffAmount", 0), status::text, "dueDate"
    into v_total, v_write_off, v_status, v_due
  from invoice
  where id = p_invoice_id
  for update;

  if not found then
    raise exception 'Invoice % not found', p_invoice_id using errcode = 'no_data_found';
  end if;

  select coalesce(sum(pa."allocatedAmount"), 0)
    into v_paid
  from payment_allocation pa
  join payment p on p.id = pa."paymentId"
  where pa."invoiceId" = p_invoice_id
    and p.status = 'CLEARED';

  v_paid := round(v_paid, 2);
  v_outstanding := round(v_total - v_paid - v_write_off, 2);

  -- DRAFT/APPROVED/CANCELLED are manual states: a balance change must not drag
  -- an unsent invoice into the sent lifecycle.
  if v_status not in ('CANCELLED', 'DRAFT', 'APPROVED') then
    if v_write_off > 0 and v_outstanding <= 0.005 then
      v_status := 'WRITTEN_OFF';
    elsif v_outstanding <= 0.005 then
      v_status := 'PAID';
    elsif v_paid > 0 then
      v_status := 'PARTIALLY_PAID';
    elsif v_due < current_date then
      v_status := 'OVERDUE';
    else
      v_status := 'SENT';
    end if;
  end if;

  update invoice
  set "paidAmount" = v_paid,
      "outstandingAmount" = v_outstanding,
      status = v_status::"InvoiceStatus",
      "updatedAt" = now()
  where id = p_invoice_id;

  return jsonb_build_object(
    'paid', v_paid,
    'outstanding', v_outstanding,
    'status', v_status
  );
end;
$$;
