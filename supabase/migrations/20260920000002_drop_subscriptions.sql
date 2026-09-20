-- Customer subscriptions are dropped: the feature is not wanted for now.
--
-- What a customer pays for on a recurring basis is still recorded as a
-- contract, which is where the renewal queue and account health read it from.
-- Quote and invoice lines keep their own snapshot of what they sold, so
-- nothing billed loses its record. Nothing outside these three tables refers to
-- them: no other table carries a subscription id.
--
-- The tables go rather than being left empty: a table nobody writes is read by
-- someone eventually, and a half-live feature is worse than an absent one.

-- By name rather than by signature, so a later argument change cannot leave a
-- function behind.
do $$
declare fn record;
begin
  for fn in
    select oid::regprocedure as signature
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'save_customer_subscription', 'change_subscription_quantity',
        'set_subscription_status', 'mark_subscription_billed',
        'app_can_manage_subscriptions'
      )
  loop
    execute format('drop function if exists %s', fn.signature);
  end loop;
end $$;

-- Invoices raised by a subscription billing run carried a link back to it.
-- Nothing reads the column, and no invoice has one set, so it goes with the
-- feature rather than being left as a dangling reference.
alter table invoice drop column if exists "subscriptionId";

-- Policies, indexes and the history tables' foreign keys go with the tables.
drop table if exists subscription_status_change;
drop table if exists subscription_quantity_change;
drop table if exists customer_subscription;
