-- Add the expense categories the business actually spends against.
--
-- The seeded six were written for client-facing project work — Travel,
-- Accommodation, Subcontractor, Software & Licences, Office & Supplies, Client
-- Entertainment. They cover what gets rebilled to a customer and nothing else.
--
-- The real ledger is mostly the opposite: rent, electricity, internet, office
-- maintenance, hardware. Those had nowhere to go, so every one of them was
-- being filed under "Office & Supplies", which makes the category useless for
-- the only question it is asked — where is the money going?
--
-- glCode follows the existing 6xxx operating-expense block. requiresReceipt is
-- true for the categories where a bill or invoice always exists (rent,
-- utilities, internet, hardware, software) and false for the small cash items
-- that often have none.

-- expense_category has no unique constraint on name, so ON CONFLICT has nothing
-- to key on and a re-run would duplicate every row. The NOT EXISTS filter is
-- what makes this idempotent.
INSERT INTO "expense_category" ("id", "name", "glCode", "requiresReceipt", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid(), v.name, v.gl_code, v.requires_receipt, true, NOW(), NOW()
FROM (VALUES
  ('Rent',        '6100', true),
  ('Utilities',   '6200', true),
  ('Internet',    '6210', true),
  ('Maintenance', '6300', false),
  ('Hardware',    '6400', true),
  ('Basic Need',  '6500', false)
) AS v(name, gl_code, requires_receipt)
WHERE NOT EXISTS (
  SELECT 1 FROM "expense_category" existing WHERE existing."name" = v.name
);
