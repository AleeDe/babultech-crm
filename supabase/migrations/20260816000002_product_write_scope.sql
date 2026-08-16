-- Let sales staff maintain the product catalogue.
--
-- 20260816000000 grouped product with the reference tables, whose write policy
-- requires ALL scope. That is right for currencies and tax rates — a wrong
-- exchange rate corrupts every amount in the system — but the catalogue is
-- worked on by the same people who build quotes, and createProduct() is
-- already gated on OPPORTUNITY_WRITE. As it stood the form was reachable and
-- the save was not, which is the worst of both.
--
-- Reads are unchanged: any internal user can see the catalogue.

drop policy if exists product_admin_write on product;

drop policy if exists product_internal_write on product;
create policy product_internal_write on product
  for all
  using (app_can_write())
  with check (app_can_write());
