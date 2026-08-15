-- Numeric defaults, the second half of 011_db_defaults.sql.
--
-- 011 handled uuid, timestamps and booleans. It missed numerics: Prisma
-- declares 43 Int/Decimal fields with @default(0) (and similar), and those
-- defaults live in the CLIENT. Through PostgREST any insert omitting them fails
-- with `null value in column "..." violates not-null constraint` — first hit on
-- invoice."writeOffAmount".
--
-- Only columns that are NOT NULL and currently have no default are touched, and
-- only ones whose Prisma default is a constant. Columns that are genuinely
-- required business input (invoice_line.unitPrice, opportunity.amount) are
-- deliberately left alone: defaulting those to 0 would let a silently empty
-- value through as a real number.

do $$
declare
  r record;
  -- Columns whose Prisma schema carries @default(0)/@default(1) and that are
  -- safe to default in the database.
  defaulted_zero text[] := array[
    'discountAmount', 'taxAmount', 'totalAmount', 'subtotal', 'paidAmount',
    'outstandingAmount', 'writeOffAmount', 'withholdingTaxAmount',
    'grossAmount', 'netAmount', 'unallocatedAmount', 'openingBalance',
    'completionPercent', 'probabilityPercent', 'helpfulCount', 'viewCount',
    'reopenCount', 'sortOrder', 'payoutDelayDays'
  ];
  defaulted_one text[] := array['exchangeRate', 'versionNumber', 'revenueSharePercent'];
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.is_nullable = 'NO'
      and c.column_default is null
      and c.column_name = any(defaulted_zero)
  loop
    execute format('alter table %I alter column %I set default 0',
                   r.table_name, r.column_name);
  end loop;

  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.is_nullable = 'NO'
      and c.column_default is null
      and c.column_name = any(defaulted_one)
  loop
    execute format('alter table %I alter column %I set default 1',
                   r.table_name, r.column_name);
  end loop;
end $$;
