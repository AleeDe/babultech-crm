-- Link a project to the product it builds or delivers.
--
-- BabulPOS is one thing playing two roles, and the schema only modelled one:
--
--   * As a PRODUCT it is something the company sells. It has a price, a cost, a
--     commission rate; it goes on a quote, an opportunity line and an invoice
--     line; and it is sold to many customers over time.
--   * As a PROJECT it is where the building happens — hours, tasks, burn.
--
-- Without a link between the two, neither question can be answered:
-- "what has BabulPOS cost us to build" lives on the project, "what has it
-- earned" lives on invoice lines, and nothing joined them.
--
-- One nullable column does it. Cost comes from time logged to projects carrying
-- the product; revenue comes from invoice lines carrying the same product. That
-- is a real per-product P&L out of data the system already collects.
--
-- Why not a `projectType` of 'PRODUCT' instead: `projectType` answers "who pays
-- for this work" (CUSTOMER vs INTERNAL) and is already enforced by a CHECK
-- constraint tying CUSTOMER to an account. What a project is *about* is a
-- different question, and a product is a real record with a price — not a
-- label. Keeping them apart means one project can be internal R&D on BabulPOS
-- and another can be customer-paid delivery of the same product, which is
-- exactly how this business actually runs.

ALTER TABLE "project"
  ADD COLUMN "productId" UUID;

-- ON DELETE SET NULL, not CASCADE: retiring a product from the catalogue must
-- never delete the record of the work done on it. The project survives with the
-- link cleared, and its hours and cost stay intact.
ALTER TABLE "project"
  ADD CONSTRAINT "project_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The index that makes "every project for this product" cheap, which is the
-- query behind a product's cost-to-date.
CREATE INDEX "project_productId_idx" ON "project"("productId");

COMMENT ON COLUMN "project"."productId" IS
  'The catalogue product this project builds or delivers. Null for work that is not about a product (a website refresh, a content team).';
