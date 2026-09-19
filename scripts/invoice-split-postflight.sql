-- Read-only confirmation that the split landed and nobody lost an authority.
select
  (select count(*) from pg_proc where proname in
     ('app_can_issue_invoice','app_can_void_invoice','app_can_close_period')) as new_functions,
  (select count(*) from pg_policies where schemaname='public' and tablename='invoice'
     and policyname in ('invoice_issue_update','invoice_void_update')) as split_policies,
  (select count(*) from pg_policies where schemaname='public' and tablename='invoice'
     and policyname='invoice_approve_update') as old_policy_must_be_zero,
  (select count(*) from pg_policies where schemaname='public' and tablename='payment'
     and policyname='payment_void_delete') as payment_policy,
  -- Every role that held the coarse grant now also holds the explicit set.
  (select count(*) from security_role
     where permissions && array['invoice:approve','invoice:*','*']
       and not (permissions @> array['invoice:issue','invoice:void','period:close','payable:approve'])) as roles_missing_grants,
  -- And nobody lost the coarse grant.
  (select count(*) from security_role where name in ('Finance','Administrator')
     and not (permissions && array['invoice:approve','invoice:*','*'])) as roles_that_lost_approve,
  (select count(*) from app_user where email like '%@example.invalid') as leftover_test_users,
  (select count(*) from security_role where name like 'Split test%') as leftover_test_roles,
  (select count(*) from invoice where "invoiceNumber" like 'SPLIT-%') as leftover_test_invoices;
