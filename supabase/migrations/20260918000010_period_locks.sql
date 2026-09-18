-- Close a month, and record which contract period an invoice was raised for.
--
-- Two things, because they are the same concern from opposite ends: what stops
-- the same month being billed twice, and what stops a closed month being
-- rewritten after the fact.
--
-- 1. Recurring drafts need to be safe to re-run. A billing run that raises a
--    second invoice for a period it already billed is a customer charged
--    twice, so the period an invoice covers is recorded on the invoice itself
--    and a unique index refuses the duplicate at the database rather than
--    trusting the run to have checked.
--
-- 2. Period locking. Once a month is closed, its invoices, payments and
--    expenses stop being editable. Corrections belong in an open month, where
--    they are visible, rather than quietly rewriting a month already reported.

-- --------------------------------------------------- the period an invoice covers

alter table invoice add column if not exists "periodStart" date;
alter table invoice add column if not exists "periodEnd" date;

-- One live invoice per contract per period. Cancelled and soft-deleted rows are
-- excluded so a cancelled invoice can be raised again, which is the whole
-- reason someone cancels one.
create unique index if not exists invoice_contract_period
  on invoice("contractId", "periodStart")
  where "contractId" is not null and "periodStart" is not null
    and "deletedAt" is null and status <> 'CANCELLED';

-- ------------------------------------------------------------- closed periods

create table if not exists accounting_period_lock (
  "periodStart" date primary key,
  "closedById" uuid not null references app_user(id),
  "closedAt" timestamptz not null default now(),
  note text not null,
  -- A reopened month keeps its row, so the history of closing and reopening
  -- survives rather than disappearing with a delete.
  "reopenedById" uuid references app_user(id),
  "reopenedAt" timestamptz,
  "reopenNote" text
);

-- A lock is held as the first day of the closed month, so a stray period like
-- 2026-01-17 cannot silently close half a month.
alter table accounting_period_lock drop constraint if exists accounting_period_lock_month;
alter table accounting_period_lock add constraint accounting_period_lock_month
  check ("periodStart" = date_trunc('month', "periodStart")::date);

alter table accounting_period_lock enable row level security;
revoke all on accounting_period_lock from public, anon, authenticated;
grant select on accounting_period_lock to authenticated;

-- Everyone who can see finance can see which months are closed; closing one is
-- an approval act.
drop policy if exists accounting_period_lock_read on accounting_period_lock;
create policy accounting_period_lock_read on accounting_period_lock
  for select to authenticated
  using (app_is_internal());

create or replace function period_is_locked(p_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from accounting_period_lock
    where "periodStart" = date_trunc('month', p_date)::date
      and "reopenedAt" is null
  );
$$;
revoke all on function period_is_locked(date) from public, anon;
grant execute on function period_is_locked(date) to authenticated;

-- Closing and reopening go through here, so both are permission-checked and
-- both leave a note behind.
create or replace function close_accounting_period(p_period date, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare actor uuid := app_current_user_id();
begin
  if actor is null or not app_has_permission('invoice:approve') then
    raise exception 'Closing a period requires invoice approval authority' using errcode = '42501';
  end if;
  if p_period <> date_trunc('month', p_period)::date then
    raise exception 'A period is closed by its month' using errcode = '22023';
  end if;
  -- Closing the month you are still trading in blocks ordinary same-day
  -- corrections, so the current month is not closable.
  if p_period >= date_trunc('month', current_date)::date then
    raise exception 'Only a month that has finished can be closed' using errcode = '22023';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'Say why this period is being closed' using errcode = '22023';
  end if;
  insert into accounting_period_lock("periodStart", "closedById", note)
  values (p_period, actor, trim(p_note))
  on conflict ("periodStart") do update
    set "closedById" = excluded."closedById",
        "closedAt" = now(),
        note = excluded.note,
        "reopenedById" = null,
        "reopenedAt" = null,
        "reopenNote" = null
    where accounting_period_lock."reopenedAt" is not null;
end $$;
revoke all on function close_accounting_period(date, text) from public, anon;
grant execute on function close_accounting_period(date, text) to authenticated;

create or replace function reopen_accounting_period(p_period date, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare actor uuid := app_current_user_id();
begin
  if actor is null or not app_has_permission('invoice:approve') then
    raise exception 'Reopening a period requires invoice approval authority' using errcode = '42501';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'Say why this period is being reopened' using errcode = '22023';
  end if;
  -- Reopening is worth a record, and the lock row is the natural place for it:
  -- audit_history deliberately has no insert policy, so nothing writes there
  -- directly. The row stays, marked reopened, which also means closing the
  -- month again is visibly a second close rather than the first.
  update accounting_period_lock
  set "reopenedById" = actor, "reopenedAt" = now(), "reopenNote" = trim(p_note)
  where "periodStart" = p_period and "reopenedAt" is null;
end $$;
revoke all on function reopen_accounting_period(date, text) from public, anon;
grant execute on function reopen_accounting_period(date, text) to authenticated;

-- ------------------------------------------------------ what a closed month refuses

-- Invoices: neither raised into a closed month nor edited once their month is
-- closed. Moving an invoice's date out of a closed month is also refused,
-- otherwise the lock is a formality.
create or replace function guard_invoice_period() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if period_is_locked(new."invoiceDate") then
      raise exception 'That month is closed. Raise this invoice in an open month.' using errcode = '23514';
    end if;
    return new;
  end if;
  if period_is_locked(old."invoiceDate") or period_is_locked(new."invoiceDate") then
    raise exception 'That month is closed. Make the correction in an open month.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function guard_invoice_period() from public, anon, authenticated;

drop trigger if exists invoice_guard_period on invoice;
create trigger invoice_guard_period before insert or update on invoice
  for each row execute function guard_invoice_period();

-- Payments: the same rule, on the date the money moved.
create or replace function guard_payment_period() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if period_is_locked(new."paymentDate") then
      raise exception 'That month is closed. Record this receipt in an open month.' using errcode = '23514';
    end if;
    return new;
  end if;
  if period_is_locked(old."paymentDate") or period_is_locked(new."paymentDate") then
    raise exception 'That month is closed. Make the correction in an open month.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function guard_payment_period() from public, anon, authenticated;

drop trigger if exists payment_guard_period on payment;
create trigger payment_guard_period before insert or update on payment
  for each row execute function guard_payment_period();

-- Expenses: claims are financial records too, and a reimbursed claim in a
-- closed month should not move afterwards.
create or replace function guard_expense_period() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if period_is_locked(new."expenseDate") then
      raise exception 'That month is closed. File this claim in an open month.' using errcode = '23514';
    end if;
    return new;
  end if;
  if period_is_locked(old."expenseDate") or period_is_locked(new."expenseDate") then
    raise exception 'That month is closed. Make the correction in an open month.' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function guard_expense_period() from public, anon, authenticated;

drop trigger if exists expense_guard_period on expense;
create trigger expense_guard_period before insert or update on expense
  for each row execute function guard_expense_period();

-- Invoice lines follow their invoice's month, so a closed invoice cannot be
-- rewritten one line at a time.
create or replace function guard_invoice_line_period() returns trigger
language plpgsql security definer set search_path = public as $$
declare invoice_date date;
begin
  select i."invoiceDate" into invoice_date from invoice i
  where i.id = coalesce(new."invoiceId", old."invoiceId");
  if invoice_date is not null and period_is_locked(invoice_date) then
    raise exception 'That month is closed. Make the correction in an open month.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;
revoke all on function guard_invoice_line_period() from public, anon, authenticated;

drop trigger if exists invoice_line_guard_period on invoice_line;
create trigger invoice_line_guard_period before insert or update or delete on invoice_line
  for each row execute function guard_invoice_line_period();
