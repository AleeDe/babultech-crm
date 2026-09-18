-- Read-only confirmation that the finance boundaries landed and the
-- verification fixtures did not.
select
  (select count(*) from pg_policies where schemaname='public' and tablename='invoice'
     and policyname in ('invoice_write_insert','invoice_write_update','invoice_approve_update','invoice_write_delete')) as invoice_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='invoice_line'
     and policyname like 'invoice_line_write_%') as invoice_line_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='payment'
     and policyname in ('payment_write_insert','payment_write_update','payment_approve_delete')) as payment_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='payment_allocation'
     and policyname like 'payment_allocation_write_%') as allocation_policies,
  -- No finance write policy may still be resting on app_can_write().
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('invoice','invoice_line','payment','payment_allocation')
     and cmd <> 'SELECT'
     and (coalesce(qual,'') like '%app_can_write()%' or coalesce(with_check,'') like '%app_can_write()%')) as stale_app_can_write,
  (select count(*) from pg_trigger where tgrelid = 'invoice'::regclass
     and tgname in ('invoice_stamp_preparer','invoice_guard_issue')) as invoice_triggers,
  (select count(*) from app_user where email like '%@example.invalid') as leftover_test_users,
  (select count(*) from security_role where name like 'Finance test%') as leftover_test_roles,
  (select count(*) from invoice where "invoiceNumber" like 'FINTEST-%') as leftover_test_invoices,
  (select count(*) from payment where "paymentNumber" like 'FINTEST-%') as leftover_test_payments,
  (select count(*) from account where "accountNumber" like 'FINTEST-%') as leftover_test_accounts,
  -- How many live invoices still have no recorded preparer, so the guard's
  -- null case is a known quantity rather than a surprise.
  (select count(*) from invoice where "preparedById" is null) as invoices_without_preparer,
  (select count(*) from invoice) as invoices_total;
