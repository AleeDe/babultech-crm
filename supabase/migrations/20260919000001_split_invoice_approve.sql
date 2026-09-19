-- Split invoice:approve into the separate authorities it had quietly become.
--
-- One permission currently carries five different powers:
--
--   1. Issuing an invoice          - asking a customer for money
--   2. Writing one off             - forgiving money already asked for
--   3. Closing an accounting month - locking the books
--   4. Approving a vendor bill     - agreeing to pay a supplier
--   5. Receiving expense approval notifications
--
-- Granting someone the first hands them all five. Asking a customer for money
-- and forgiving what they owe are close to opposite acts, and closing the books
-- is neither. That is not a distinction the person granting the role can make
-- today, so this makes each one grantable on its own:
--
--   invoice:issue   - issue an invoice
--   invoice:void    - write off or cancel one
--   period:close    - close and reopen an accounting month
--   payable:approve - approve a vendor bill for payment
--
-- NOTHING IS TAKEN AWAY
--
-- invoice:approve keeps working everywhere it worked before, because a
-- migration that silently removes an authority someone is relying on breaks
-- their Monday. It is now the coarse grant: holding it still implies all four.
-- The narrow grants exist so new roles can be given one without the rest.
--
-- Whether to move anyone onto the narrow grants is a business decision. This
-- changes no user's role.

-- ------------------------------------------------------- the new permissions
--
-- Holding invoice:approve continues to satisfy each of these, so this is a
-- widening, not a replacement. The check functions below carry that rule so it
-- lives in one place rather than being repeated at each call site.

create or replace function app_can_issue_invoice()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_is_internal()
     and (app_has_permission('invoice:issue') or app_has_permission('invoice:approve'));
$$;
revoke all on function app_can_issue_invoice() from public, anon;
grant execute on function app_can_issue_invoice() to authenticated;

create or replace function app_can_void_invoice()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_is_internal()
     and (app_has_permission('invoice:void') or app_has_permission('invoice:approve'));
$$;
revoke all on function app_can_void_invoice() from public, anon;
grant execute on function app_can_void_invoice() to authenticated;

create or replace function app_can_close_period()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select app_is_internal()
     and (app_has_permission('period:close') or app_has_permission('invoice:approve'));
$$;
revoke all on function app_can_close_period() from public, anon;
grant execute on function app_can_close_period() to authenticated;

-- --------------------------------------------- existing holders keep everything
--
-- Finance and Administrator ran the whole finance module through
-- invoice:approve, so they take the explicit set too. After this their
-- permissions say what they can do rather than implying it, which is what lets
-- a future role be given less.

update "security_role"
set "permissions" = array(
      select distinct unnest(
        "permissions" || array['invoice:issue', 'invoice:void', 'period:close', 'payable:approve']
      )
    ),
    "updatedAt" = now()
where "permissions" && array['invoice:approve', 'invoice:*', '*'];

-- ------------------------------------------------ the policies that enforce it

-- Issuing and voiding are both updates to an invoice out of a draft state, and
-- 20260918000009 gated them together under invoice:approve. Separate them.
drop policy if exists invoice_approve_update on invoice;

create policy invoice_issue_update on invoice for update to authenticated
  using (app_can_issue_invoice())
  with check (app_can_issue_invoice() and status in ('SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'DRAFT', 'APPROVED'));

create policy invoice_void_update on invoice for update to authenticated
  using (app_can_void_invoice())
  with check (app_can_void_invoice() and status in ('CANCELLED', 'WRITTEN_OFF', 'DRAFT', 'APPROVED'));

-- Deleting a receipt was gated on invoice:approve; it is a correction to the
-- ledger, so it follows voiding rather than issuing.
drop policy if exists payment_approve_delete on payment;
create policy payment_void_delete on payment for delete to authenticated
  using (app_can_void_invoice());

-- Closing a period now has its own authority.
create or replace function close_accounting_period(p_period date, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare actor uuid := app_current_user_id();
begin
  if actor is null or not app_can_close_period() then
    raise exception 'Closing a period requires period-closing authority' using errcode = '42501';
  end if;
  if p_period <> date_trunc('month', p_period)::date then
    raise exception 'A period is closed by its month' using errcode = '22023';
  end if;
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
  if actor is null or not app_can_close_period() then
    raise exception 'Reopening a period requires period-closing authority' using errcode = '42501';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    raise exception 'Say why this period is being reopened' using errcode = '22023';
  end if;
  update accounting_period_lock
  set "reopenedById" = actor, "reopenedAt" = now(), "reopenNote" = trim(p_note)
  where "periodStart" = p_period and "reopenedAt" is null;
end $$;
revoke all on function reopen_accounting_period(date, text) from public, anon;
grant execute on function reopen_accounting_period(date, text) to authenticated;
