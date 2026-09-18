-- Read-only confirmation that period locking landed and no fixtures remain.
select
  (select count(*) from pg_indexes where schemaname='public' and indexname='invoice_contract_period') as period_index,
  (select count(*) from pg_trigger where tgname in
     ('invoice_guard_period','payment_guard_period','expense_guard_period','invoice_line_guard_period')) as period_triggers,
  (select count(*) from pg_proc where proname in
     ('close_accounting_period','reopen_accounting_period','period_is_locked')) as period_functions,
  (select count(*) from information_schema.columns where table_name='invoice'
     and column_name in ('periodStart','periodEnd','preparedById','issuedById')) as invoice_columns,
  -- The cancel fix: a cancellation must not be treated as issuing.
  (select count(*) from pg_proc where proname='guard_invoice_issue'
     and prosrc like '%PARTIALLY_PAID%') as issue_guard_lists_billing_statuses,
  (select count(*) from accounting_period_lock) as locks_total,
  (select count(*) from app_user where email like '%@example.invalid') as leftover_test_users,
  (select count(*) from security_role where name like 'Period test%' or name like 'QA per %') as leftover_test_roles,
  (select count(*) from account where "accountNumber" like 'QAPER-%' or "accountNumber" like 'PERTEST-%') as leftover_test_accounts,
  (select count(*) from contract where "contractNumber" like 'QAPER-%' or "contractNumber" like 'PERTEST-%') as leftover_test_contracts,
  (select count(*) from invoice where "invoiceNumber" like 'QAPER-%' or "invoiceNumber" like 'PERTEST-%') as leftover_test_invoices;
