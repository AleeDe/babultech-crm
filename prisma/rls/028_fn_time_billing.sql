-- Time-and-materials billing run.
--
-- Ports the prisma.$transaction in src/server/billing.ts (runTimeBilling):
-- create the invoice, create one line per person-and-rate group, then stamp
-- every time log in each group with the id of the line that billed it.
--
-- The stamp is what stops the next run billing the same hours again. If the
-- invoice and its lines landed but the stamps did not, those hours would be
-- invoiced a second time on the next run — the customer billed twice for the
-- same work.
--
-- p_groups is [{ "description", "hours", "rate", "lineTotal", "logIds":[uuid] }, …]
-- with the grouping and money already worked out by the caller.

create or replace function run_time_billing(
  p_project_id  uuid,
  p_account_id  uuid,
  p_contract_id uuid,
  p_currency    text,
  p_notes       text,
  p_subtotal    numeric,
  p_groups      jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_invoice_id uuid := gen_random_uuid();
  v_number     text;
  v_group      jsonb;
  v_line_id    uuid;
  v_index      integer := 0;
begin
  v_number := next_sequence_number('Invoice');

  insert into invoice (
    id, "invoiceNumber", "accountId", "projectId", "contractId", "invoiceDate",
    "dueDate", status, "currencyCode", subtotal, "discountAmount", "taxAmount",
    "totalAmount", "paidAmount", "outstandingAmount", "paymentTermsDays", notes,
    "createdAt", "updatedAt"
  ) values (
    v_invoice_id, v_number, p_account_id, p_project_id, p_contract_id,
    current_date, current_date + 30, 'DRAFT', p_currency, p_subtotal, 0, 0,
    p_subtotal, 0, p_subtotal, 30, p_notes, now(), now()
  );

  for v_group in select * from jsonb_array_elements(p_groups)
  loop
    v_line_id := gen_random_uuid();

    insert into invoice_line (
      id, "invoiceId", "projectId", description, quantity, "unitPrice",
      "lineTotal", "sortOrder", "createdAt", "updatedAt"
    ) values (
      v_line_id, v_invoice_id, p_project_id, v_group->>'description',
      (v_group->>'hours')::numeric, (v_group->>'rate')::numeric,
      (v_group->>'lineTotal')::numeric, v_index, now(), now()
    );

    -- Stamp the time so the next run cannot bill it again.
    update time_log
    set "invoiceLineId" = v_line_id, "updatedAt" = now()
    where id in (
      select (jsonb_array_elements_text(v_group->'logIds'))::uuid
    );

    v_index := v_index + 1;
  end loop;

  return jsonb_build_object('id', v_invoice_id, 'invoiceNumber', v_number);
end;
$$;
