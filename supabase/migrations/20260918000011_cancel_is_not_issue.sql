-- Cancelling a draft is not issuing it.
--
-- 20260918000009 defined "issuing" as any move out of an editable status, so
-- guard_invoice_issue() also caught DRAFT -> CANCELLED and told whoever raised
-- a draft that they could not cancel their own mistake. Nobody is billed by a
-- cancellation, so the separation-of-duties rule has nothing to protect there.
--
-- Issuing is the act that creates a receivable. That is what the guard is for.

create or replace function guard_invoice_issue() returns trigger
language plpgsql security definer set search_path = public as $$
declare actor uuid := app_current_user_id();
begin
  -- Only a move into a status that bills the customer counts as issuing.
  -- CANCELLED and WRITTEN_OFF end an invoice rather than sending one.
  if invoice_is_editable(old.status)
     and new.status in ('SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE') then
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

-- The same mistake in the write policy: invoice_write_update required the new
-- status to still be editable, so a finance operator could not cancel the draft
-- they had just raised either. Abandoning a draft is part of drafting; what
-- invoice:write must not reach is a status that bills the customer.
drop policy if exists invoice_write_update on invoice;
create policy invoice_write_update on invoice for update to authenticated
  using (app_can_write_finance('invoice:write') and invoice_is_editable(status))
  with check (
    app_can_write_finance('invoice:write')
    and (invoice_is_editable(status) or status = 'CANCELLED')
  );
