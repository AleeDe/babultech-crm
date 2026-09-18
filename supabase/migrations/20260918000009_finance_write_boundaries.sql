-- Put the receivables ledger behind the permissions that already name it, and
-- stop one person issuing an invoice they raised themselves.
--
-- Two gaps, both of which let a caller who never opens the finance screens do
-- finance work through the database.
--
-- 1. Writes. invoice, invoice_line, payment and payment_allocation carry
--    policies declared FOR INSERT/UPDATE/DELETE with app_can_write(), and
--    app_can_write() asks only "is this an internal user with any scope at
--    all". src/server/billing.ts checks invoice:write and invoice:approve on
--    every action, but PostgREST is reachable without going through it, so a
--    contributor's own token could flip an invoice from DRAFT to SENT, change
--    totalAmount, or record a payment that was never received. The server
--    checks were the only thing standing there.
--
-- 2. Separation of duties. setExpenseApproval has refused self-approval since
--    20260830000000, but the invoice path never grew the same rule: whoever
--    raises an invoice can also issue it. Issuing is what creates the
--    receivable and accrues partner commission, so it is the decision that
--    wants a second person.
--
-- app_can_write() is deliberately left alone. 45 tables lean on it and this
-- migration is about the four that move money.

-- ---------------------------------------------------------------- helpers

-- Finance writes: internal, active, and actually granted the permission.
-- SECURITY DEFINER so the policy does not re-enter app_user's own policies.
create or replace function app_can_write_finance(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_is_internal() and app_has_permission(p_permission);
$$;
revoke all on function app_can_write_finance(text) from public, anon;
grant execute on function app_can_write_finance(text) to authenticated;

-- An invoice stops being a draft the moment it is issued. After that its
-- money-bearing columns are the ledger, not a form.
create or replace function invoice_is_editable(p_status "InvoiceStatus")
returns boolean
language sql
immutable
as $$
  -- Matches EDITABLE_INVOICE in src/server/billing.ts. APPROVED here means
  -- approved to issue, not yet issued, so it is still a draft in ledger terms.
  select p_status in ('DRAFT', 'APPROVED');
$$;

-- ---------------------------------------------------------------- invoice

drop policy if exists invoice_internal_write on invoice;
drop policy if exists invoice_internal_insert on invoice;
drop policy if exists invoice_internal_update on invoice;
drop policy if exists invoice_internal_delete on invoice;

-- Raising a draft needs invoice:write. It may only be born as a draft; an
-- invoice that arrives already SENT has skipped the approval it exists for.
create policy invoice_write_insert on invoice for insert to authenticated
  with check (app_can_write_finance('invoice:write') and status in ('DRAFT', 'APPROVED'));

-- Editing the figures is a drafting act and stays with invoice:write, but only
-- while the invoice is still a draft. Everything else - issuing it, voiding it,
-- writing it off, recording what was paid - is an approval act.
create policy invoice_write_update on invoice for update to authenticated
  using (app_can_write_finance('invoice:write') and invoice_is_editable(status))
  with check (app_can_write_finance('invoice:write') and invoice_is_editable(status));

create policy invoice_approve_update on invoice for update to authenticated
  using (app_can_write_finance('invoice:approve'))
  with check (app_can_write_finance('invoice:approve'));

-- Deleting an issued invoice would remove a receivable from the ledger
-- silently; soft-delete it through the application instead.
create policy invoice_write_delete on invoice for delete to authenticated
  using (app_can_write_finance('invoice:write') and invoice_is_editable(status));

-- ----------------------------------------------------------- invoice_line

drop policy if exists invoice_line_internal_write on invoice_line;
drop policy if exists invoice_line_internal_insert on invoice_line;
drop policy if exists invoice_line_internal_update on invoice_line;
drop policy if exists invoice_line_internal_delete on invoice_line;

-- Lines follow their invoice: editable while it drafts, frozen once issued.
-- Without this, the total stays honest while the lines beneath it change.
create policy invoice_line_write_insert on invoice_line for insert to authenticated
  with check (app_can_write_finance('invoice:write')
    and exists (select 1 from invoice i where i.id = "invoiceId" and invoice_is_editable(i.status)));

create policy invoice_line_write_update on invoice_line for update to authenticated
  using (app_can_write_finance('invoice:write')
    and exists (select 1 from invoice i where i.id = "invoiceId" and invoice_is_editable(i.status)))
  with check (app_can_write_finance('invoice:write')
    and exists (select 1 from invoice i where i.id = "invoiceId" and invoice_is_editable(i.status)));

create policy invoice_line_write_delete on invoice_line for delete to authenticated
  using (app_can_write_finance('invoice:write')
    and exists (select 1 from invoice i where i.id = "invoiceId" and invoice_is_editable(i.status)));

-- ---------------------------------------------------------------- payment

drop policy if exists payment_internal_write on payment;
drop policy if exists payment_internal_insert on payment;
drop policy if exists payment_internal_update on payment;
drop policy if exists payment_internal_delete on payment;

-- Recording money received is its own permission and is not implied by being
-- able to draft an invoice.
create policy payment_write_insert on payment for insert to authenticated
  with check (app_can_write_finance('payment:write'));

create policy payment_write_update on payment for update to authenticated
  using (app_can_write_finance('payment:write'))
  with check (app_can_write_finance('payment:write'));

-- Deleting a receipt loses the audit trail of money that arrived. Reversal is
-- an application concern; the row stays.
create policy payment_approve_delete on payment for delete to authenticated
  using (app_can_write_finance('invoice:approve'));

-- ------------------------------------------------------ payment_allocation

drop policy if exists payment_allocation_internal_write on payment_allocation;
drop policy if exists payment_allocation_internal_insert on payment_allocation;
drop policy if exists payment_allocation_internal_update on payment_allocation;
drop policy if exists payment_allocation_internal_delete on payment_allocation;

create policy payment_allocation_write_insert on payment_allocation for insert to authenticated
  with check (app_can_write_finance('payment:write'));

create policy payment_allocation_write_update on payment_allocation for update to authenticated
  using (app_can_write_finance('payment:write'))
  with check (app_can_write_finance('payment:write'));

create policy payment_allocation_write_delete on payment_allocation for delete to authenticated
  using (app_can_write_finance('payment:write'));

-- ------------------------------------------- separation of duties on issue

-- Who raised each invoice. audit_history already records it, but a trigger
-- cannot depend on an audit row still being there, and a column that is set
-- once and never rewritten is the cheaper thing to check.
alter table invoice add column if not exists "preparedById" uuid references app_user(id);
alter table invoice add column if not exists "issuedById" uuid references app_user(id);

create or replace function stamp_invoice_preparer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new."preparedById" := coalesce(new."preparedById", app_current_user_id());
  return new;
end $$;
revoke all on function stamp_invoice_preparer() from public, anon, authenticated;

drop trigger if exists invoice_stamp_preparer on invoice;
create trigger invoice_stamp_preparer before insert on invoice
  for each row execute function stamp_invoice_preparer();

-- Backfill from audit history where it is unambiguous, so existing invoices
-- are not left with a null preparer that the guard would wave through.
update invoice i
set "preparedById" = a."changedById"
from (
  select distinct on ("entityId") "entityId", "changedById"
  from audit_history
  where "entityType" = 'Invoice' and "changedById" is not null
  order by "entityId", "changedAt" asc
) a
where a."entityId" = i.id and i."preparedById" is null;

-- The rule: the person who prepared an invoice does not get to issue it.
-- Anything that moves it out of a draft state counts as issuing, whichever
-- column the caller touches.
create or replace function guard_invoice_issue() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := app_current_user_id();
begin
  if invoice_is_editable(old.status) and not invoice_is_editable(new.status) then
    if actor is null then
      raise exception 'Issuing an invoice requires a signed-in user' using errcode = '42501';
    end if;
    -- A null preparer means we genuinely do not know who raised it, which is
    -- not the same as knowing it was someone else.
    if old."preparedById" is not null and old."preparedById" = actor then
      raise exception 'An invoice must be issued by someone other than the person who prepared it'
        using errcode = '23514';
    end if;
    new."issuedById" := actor;
  end if;
  return new;
end $$;
revoke all on function guard_invoice_issue() from public, anon, authenticated;

drop trigger if exists invoice_guard_issue on invoice;
create trigger invoice_guard_issue before update on invoice
  for each row execute function guard_invoice_issue();
