-- Calculated reporting views (spec §11), plus two partner/commission views
-- added with the Partner Management extension.
--   psql "$DATABASE_URL" -f prisma/sql/02_views.sql

-- --------------------------------------------------------------------------
-- Accounts Receivable — spec §11 / §13 "receivables derive only from
-- approved/sent invoices that are not cancelled or fully written off".
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_accounts_receivable AS
SELECT
  i.id                        AS invoice_id,
  i."invoiceNumber"           AS invoice_number,
  i."accountId"               AS account_id,
  a.name                      AS account_name,
  i."currencyCode"            AS currency_code,
  i."invoiceDate"             AS invoice_date,
  i."dueDate"                 AS due_date,
  i.status,
  i."totalAmount"             AS total_amount,
  i."paidAmount"              AS paid_amount,
  i."writeOffAmount"          AS write_off_amount,
  i."totalAmount" - i."paidAmount" - i."writeOffAmount" AS outstanding_amount,
  GREATEST(0, (CURRENT_DATE - i."dueDate"))            AS days_overdue,
  CASE
    WHEN i."totalAmount" - i."paidAmount" - i."writeOffAmount" <= 0 THEN 'Settled'
    WHEN CURRENT_DATE <= i."dueDate"       THEN 'Current'
    WHEN CURRENT_DATE - i."dueDate" <= 30  THEN '1-30 days'
    WHEN CURRENT_DATE - i."dueDate" <= 60  THEN '31-60 days'
    WHEN CURRENT_DATE - i."dueDate" <= 90  THEN '61-90 days'
    ELSE '90+ days'
  END AS ageing_bucket
FROM invoice i
JOIN account a ON a.id = i."accountId"
WHERE i."deletedAt" IS NULL
  AND i.status NOT IN ('DRAFT', 'CANCELLED', 'WRITTEN_OFF');

-- --------------------------------------------------------------------------
-- Accounts Payable — approved vendor bills that are not cancelled.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_accounts_payable AS
SELECT
  b.id                  AS vendor_bill_id,
  b."billNumber"        AS bill_number,
  b."vendorAccountId"   AS vendor_account_id,
  a.name                AS vendor_name,
  b."currencyCode"      AS currency_code,
  b."billDate"          AS bill_date,
  b."dueDate"           AS due_date,
  b.status,
  b."totalAmount"       AS total_amount,
  b."paidAmount"        AS paid_amount,
  b."totalAmount" - b."paidAmount" AS outstanding_amount,
  GREATEST(0, (CURRENT_DATE - b."dueDate")) AS days_overdue,
  CASE
    WHEN b."totalAmount" - b."paidAmount" <= 0 THEN 'Settled'
    WHEN CURRENT_DATE <= b."dueDate"      THEN 'Current'
    WHEN CURRENT_DATE - b."dueDate" <= 30 THEN '1-30 days'
    WHEN CURRENT_DATE - b."dueDate" <= 60 THEN '31-60 days'
    WHEN CURRENT_DATE - b."dueDate" <= 90 THEN '61-90 days'
    ELSE '90+ days'
  END AS ageing_bucket
FROM vendor_bill b
JOIN account a ON a.id = b."vendorAccountId"
WHERE b."deletedAt" IS NULL
  AND b.status NOT IN ('DRAFT', 'CANCELLED');

-- --------------------------------------------------------------------------
-- Revenue Summary — net of tax, excluding cancelled invoices.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_revenue_summary AS
SELECT
  date_trunc('month', i."invoiceDate")::date AS period_month,
  i."accountId"        AS account_id,
  a.name               AS account_name,
  il."productId"       AS product_id,
  p.name               AS product_name,
  il."projectId"       AS project_id,
  il."revenueCategory" AS revenue_category,
  i."currencyCode"     AS currency_code,
  SUM(il."lineTotal")  AS revenue_amount,
  COUNT(DISTINCT i.id) AS invoice_count
FROM invoice_line il
JOIN invoice i ON i.id = il."invoiceId"
JOIN account a ON a.id = i."accountId"
LEFT JOIN product p ON p.id = il."productId"
WHERE i."deletedAt" IS NULL
  AND i.status NOT IN ('DRAFT', 'CANCELLED')
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8;

-- --------------------------------------------------------------------------
-- Project Profitability — revenue vs labour cost vs external cost.
-- Commission paid on the deal is treated as a cost of sale.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_project_profitability AS
WITH revenue AS (
  SELECT il."projectId" AS project_id, SUM(il."lineTotal") AS amount
  FROM invoice_line il
  JOIN invoice i ON i.id = il."invoiceId"
  WHERE i.status NOT IN ('DRAFT', 'CANCELLED') AND i."deletedAt" IS NULL
  GROUP BY 1
),
labour AS (
  SELECT "projectId" AS project_id, SUM(hours * COALESCE("costRate", 0)) AS amount, SUM(hours) AS hours
  FROM time_log
  WHERE "approvalStatus" = 'APPROVED'
  GROUP BY 1
),
expenses AS (
  SELECT "projectId" AS project_id, SUM(amount) AS amount
  FROM expense WHERE "approvalStatus" = 'APPROVED' AND "deletedAt" IS NULL
  GROUP BY 1
),
supplier AS (
  SELECT vbl."projectId" AS project_id, SUM(vbl."lineTotal") AS amount
  FROM vendor_bill_line vbl
  JOIN vendor_bill vb ON vb.id = vbl."vendorBillId"
  WHERE vb.status NOT IN ('DRAFT', 'CANCELLED') AND vb."deletedAt" IS NULL
  GROUP BY 1
),
commissions AS (
  SELECT p.id AS project_id, SUM(cr."commissionAmount") AS amount
  FROM commission_record cr
  JOIN project p ON p."opportunityId" = cr."opportunityId"
  WHERE cr.status NOT IN ('REJECTED', 'CANCELLED', 'DRAFT') AND cr."deletedAt" IS NULL
  GROUP BY 1
)
SELECT
  pr.id                                  AS project_id,
  pr."projectNumber"                     AS project_number,
  pr.name                                AS project_name,
  pr."accountId"                         AS account_id,
  pr.status,
  pr."currencyCode"                      AS currency_code,
  COALESCE(r.amount, 0)                  AS revenue,
  COALESCE(l.amount, 0)                  AS labour_cost,
  COALESCE(l.hours, 0)                   AS logged_hours,
  COALESCE(e.amount, 0) + COALESCE(s.amount, 0) AS external_cost,
  COALESCE(c.amount, 0)                  AS commission_cost,
  COALESCE(r.amount, 0)
    - COALESCE(l.amount, 0)
    - COALESCE(e.amount, 0)
    - COALESCE(s.amount, 0)
    - COALESCE(c.amount, 0)              AS gross_margin,
  CASE WHEN COALESCE(r.amount, 0) = 0 THEN NULL ELSE ROUND(
    ((COALESCE(r.amount,0) - COALESCE(l.amount,0) - COALESCE(e.amount,0)
      - COALESCE(s.amount,0) - COALESCE(c.amount,0)) / r.amount) * 100, 2)
  END AS margin_percent
FROM project pr
LEFT JOIN revenue r     ON r.project_id = pr.id
LEFT JOIN labour l      ON l.project_id = pr.id
LEFT JOIN expenses e    ON e.project_id = pr.id
LEFT JOIN supplier s    ON s.project_id = pr.id
LEFT JOIN commissions c ON c.project_id = pr.id
WHERE pr."deletedAt" IS NULL;

-- --------------------------------------------------------------------------
-- Campaign Performance — cost, leads, conversions, pipeline, ROI.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_campaign_performance AS
WITH lead_stats AS (
  SELECT "campaignId" AS campaign_id,
         COUNT(*) AS leads,
         COUNT(*) FILTER (WHERE status = 'CONVERTED') AS converted_leads
  FROM lead WHERE "deletedAt" IS NULL GROUP BY 1
),
member_stats AS (
  SELECT "campaignId" AS campaign_id,
         COUNT(*) AS members,
         COUNT(*) FILTER (WHERE responded) AS responses
  FROM campaign_member GROUP BY 1
),
opp_stats AS (
  SELECT "campaignId" AS campaign_id,
         COUNT(*) AS opportunities,
         SUM(amount) AS pipeline_value,
         SUM(amount) FILTER (WHERE stage = 'CLOSED_WON') AS won_value,
         COUNT(*) FILTER (WHERE stage = 'CLOSED_WON') AS won_count
  FROM opportunity WHERE "deletedAt" IS NULL GROUP BY 1
),
invoiced AS (
  SELECT o."campaignId" AS campaign_id, SUM(il."lineTotal") AS invoiced_revenue
  FROM opportunity o
  JOIN project pj ON pj."opportunityId" = o.id
  JOIN invoice_line il ON il."projectId" = pj.id
  JOIN invoice i ON i.id = il."invoiceId"
  WHERE i.status NOT IN ('DRAFT', 'CANCELLED')
  GROUP BY 1
)
SELECT
  c.id                              AS campaign_id,
  c.name                            AS campaign_name,
  c.status,
  c."startDate"                     AS start_date,
  c."endDate"                       AS end_date,
  COALESCE(c."budgetAmount", 0)     AS budget_amount,
  COALESCE(c."actualCost", 0)       AS actual_cost,
  COALESCE(m.members, 0)            AS members,
  COALESCE(m.responses, 0)          AS responses,
  COALESCE(l.leads, 0)              AS leads,
  COALESCE(l.converted_leads, 0)    AS converted_leads,
  COALESCE(o.opportunities, 0)      AS opportunities,
  COALESCE(o.pipeline_value, 0)     AS pipeline_value,
  COALESCE(o.won_value, 0)          AS won_value,
  COALESCE(o.won_count, 0)          AS won_count,
  COALESCE(inv.invoiced_revenue, 0) AS invoiced_revenue,
  CASE WHEN COALESCE(c."actualCost", 0) = 0 THEN NULL
       ELSE ROUND(((COALESCE(o.won_value, 0) - c."actualCost") / c."actualCost") * 100, 2)
  END AS roi_percent,
  CASE WHEN COALESCE(l.leads, 0) = 0 THEN NULL
       ELSE ROUND(COALESCE(c."actualCost", 0) / l.leads, 2)
  END AS cost_per_lead
FROM campaign c
LEFT JOIN lead_stats   l   ON l.campaign_id = c.id
LEFT JOIN member_stats m   ON m.campaign_id = c.id
LEFT JOIN opp_stats    o   ON o.campaign_id = c.id
LEFT JOIN invoiced     inv ON inv.campaign_id = c.id
WHERE c."deletedAt" IS NULL;

-- --------------------------------------------------------------------------
-- Partner Performance (extension) — what each partner brought in and earned.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_partner_performance AS
WITH deals AS (
  SELECT op."partnerId" AS partner_id,
         COUNT(*)                                            AS deals_total,
         COUNT(*) FILTER (WHERE o.stage = 'CLOSED_WON')       AS deals_won,
         COUNT(*) FILTER (WHERE o.stage = 'CLOSED_LOST')      AS deals_lost,
         COUNT(*) FILTER (WHERE o.stage NOT IN ('CLOSED_WON','CLOSED_LOST')) AS deals_open,
         SUM(o.amount * op."revenueSharePercent" / 100)       AS sourced_pipeline,
         SUM(o.amount * op."revenueSharePercent" / 100)
           FILTER (WHERE o.stage = 'CLOSED_WON')              AS sourced_won_value
  FROM opportunity_partner op
  JOIN opportunity o ON o.id = op."opportunityId" AND o."deletedAt" IS NULL
  GROUP BY 1
),
comm AS (
  SELECT "partnerId" AS partner_id,
         SUM("commissionAmount")                                        AS commission_total,
         SUM("commissionAmount") FILTER (WHERE status IN ('ACCRUED','PENDING_APPROVAL')) AS commission_accrued,
         SUM("netPayableAmount") FILTER (WHERE status IN ('APPROVED','PAYABLE','PARTIALLY_PAID')) AS commission_payable,
         SUM("netPayableAmount") FILTER (WHERE status = 'PAID')          AS commission_paid
  FROM commission_record WHERE "deletedAt" IS NULL GROUP BY 1
),
refs AS (
  SELECT "referredByPartnerId" AS partner_id, COUNT(*) AS referred_leads
  FROM lead WHERE "referredByPartnerId" IS NOT NULL AND "deletedAt" IS NULL GROUP BY 1
)
SELECT
  p.id                              AS partner_id,
  p."partnerNumber"                 AS partner_number,
  p."displayName"                   AS partner_name,
  p.kind,
  p."partnerType"                   AS partner_type,
  p.tier,
  p.status,
  COALESCE(r.referred_leads, 0)     AS referred_leads,
  COALESCE(d.deals_total, 0)        AS deals_total,
  COALESCE(d.deals_open, 0)         AS deals_open,
  COALESCE(d.deals_won, 0)          AS deals_won,
  COALESCE(d.deals_lost, 0)         AS deals_lost,
  COALESCE(d.sourced_pipeline, 0)   AS sourced_pipeline,
  COALESCE(d.sourced_won_value, 0)  AS sourced_won_value,
  CASE WHEN COALESCE(d.deals_won, 0) + COALESCE(d.deals_lost, 0) = 0 THEN NULL
       ELSE ROUND((d.deals_won::numeric / (d.deals_won + d.deals_lost)) * 100, 2)
  END                               AS win_rate_percent,
  COALESCE(c.commission_total, 0)   AS commission_total,
  COALESCE(c.commission_accrued, 0) AS commission_accrued,
  COALESCE(c.commission_payable, 0) AS commission_payable,
  COALESCE(c.commission_paid, 0)    AS commission_paid
FROM partner p
LEFT JOIN deals d ON d.partner_id = p.id
LEFT JOIN comm  c ON c.partner_id = p.id
LEFT JOIN refs  r ON r.partner_id = p.id
WHERE p."deletedAt" IS NULL;

-- --------------------------------------------------------------------------
-- Commission Liability (extension) — what the company currently owes partners.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_commission_liability AS
SELECT
  cr."currencyCode"   AS currency_code,
  cr.status,
  COUNT(*)            AS record_count,
  SUM(cr."commissionAmount")     AS gross_amount,
  SUM(cr."withholdingTaxAmount") AS withholding_amount,
  SUM(cr."netPayableAmount")     AS net_amount,
  MIN(cr."payableFromDate")      AS earliest_payable_date
FROM commission_record cr
WHERE cr."deletedAt" IS NULL
  AND cr.status IN ('ACCRUED', 'PENDING_APPROVAL', 'APPROVED', 'PAYABLE', 'PARTIALLY_PAID')
GROUP BY 1, 2;

-- --------------------------------------------------------------------------
-- Sales Pipeline — weighted forecast by stage and owner.
-- --------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sales_pipeline AS
SELECT
  o.stage,
  o."ownerUserId"                                   AS owner_user_id,
  u."fullName"                                      AS owner_name,
  o."currencyCode"                                  AS currency_code,
  COUNT(*)                                          AS deal_count,
  SUM(o.amount)                                     AS total_amount,
  SUM(o.amount * o."probabilityPercent" / 100)      AS weighted_amount,
  date_trunc('month', o."expectedCloseDate")::date  AS close_month
FROM opportunity o
JOIN app_user u ON u.id = o."ownerUserId"
WHERE o."deletedAt" IS NULL
GROUP BY 1, 2, 3, 4, 8;
