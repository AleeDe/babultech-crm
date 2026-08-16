-- Atomic quote revision.
--
-- Ports reviseQuotation() from src/server/quotations.ts: copy the quote and its
-- lines to a new version, then mark the original REVISED.
--
-- Both halves must land together. If the copy succeeded but the original stayed
-- open, the opportunity would carry two live quotes — and
-- `quotation_one_accepted_per_opportunity` (the partial unique index in
-- prisma/sql) only stops two ACCEPTED ones, not two DRAFTs.

create or replace function revise_quotation(
  p_id       uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_orig    quotation%rowtype;
  v_last    integer;
  v_new_id  uuid := gen_random_uuid();
  v_number  text;
begin
  select * into v_orig from quotation where id = p_id for update;

  if not found then
    raise exception 'Quote % not found', p_id using errcode = 'no_data_found';
  end if;

  if v_orig.status = 'ACCEPTED' then
    raise exception 'An accepted quote cannot be revised — it is the basis of the deal.'
      using errcode = 'raise_exception';
  end if;

  select coalesce(max("versionNumber"), 0) into v_last
  from quotation where "opportunityId" = v_orig."opportunityId";

  v_number := next_sequence_number('Quotation');

  insert into quotation (
    id, "quoteNumber", "opportunityId", "accountId", "contactId",
    "versionNumber", status, "quoteDate", "expiryDate", "currencyCode",
    subtotal, "discountAmount", "taxAmount", "totalAmount", "paymentTerms",
    notes, "termsAndConditions", "createdAt", "updatedAt"
  ) values (
    v_new_id, v_number, v_orig."opportunityId", v_orig."accountId",
    v_orig."contactId", v_last + 1, 'DRAFT', current_date, current_date + 30,
    v_orig."currencyCode", v_orig.subtotal, v_orig."discountAmount",
    v_orig."taxAmount", v_orig."totalAmount", v_orig."paymentTerms",
    v_orig.notes, v_orig."termsAndConditions", now(), now()
  );

  insert into quote_line (
    id, "quotationId", "productId", description, quantity, "unitPrice",
    "discountPercent", "taxRateId", "lineTotal", "sortOrder",
    "createdAt", "updatedAt"
  )
  select gen_random_uuid(), v_new_id, l."productId", l.description, l.quantity,
         l."unitPrice", l."discountPercent", l."taxRateId", l."lineTotal",
         (row_number() over (order by l."sortOrder"))::int - 1,
         now(), now()
  from quote_line l
  where l."quotationId" = p_id;

  update quotation
  set status = 'REVISED', "updatedAt" = now()
  where id = p_id;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", source, "changedAt"
  ) values (
    gen_random_uuid(), 'Quotation', p_id, 'status', v_orig.status::text,
    'REVISED', p_actor_id, 'UI', now()
  );

  return jsonb_build_object('id', v_new_id, 'quoteNumber', v_number);
end;
$$;
