-- Campaign performance, again.
--
-- v_campaign_performance (20260815000006) counted campaign members, so when
-- 20260921000001 rebuilt campaign_member with DROP TABLE ... CASCADE the view
-- went with it, silently. The Campaigns page has shown "apply 02_views.sql"
-- ever since. Recreated against today's tables: a member belongs to a campaign
-- through campaign_member."campaignId", and a member has responded once they
-- became a lead.

create or replace view v_campaign_performance
with (security_invoker = true)
as
with lead_stats as (
  select "campaignId" as campaign_id,
         count(*) as leads,
         count(*) filter (where status::text = 'CONVERTED') as converted_leads
  from lead
  where "deletedAt" is null and "campaignId" is not null
  group by 1
),
member_stats as (
  select "campaignId" as campaign_id,
         count(*) as members,
         count(*) filter (where "leadId" is not null or "convertedAt" is not null) as responses
  from campaign_member
  where "deletedAt" is null and "campaignId" is not null
  group by 1
),
opp_stats as (
  select "campaignId" as campaign_id,
         count(*) as opportunities,
         sum(amount) as pipeline_value,
         sum(amount) filter (where stage::text = 'CLOSED_WON') as won_value,
         count(*) filter (where stage::text = 'CLOSED_WON') as won_count
  from opportunity
  where "deletedAt" is null and "campaignId" is not null
  group by 1
),
invoiced as (
  select o."campaignId" as campaign_id, sum(il."lineTotal") as invoiced_revenue
  from opportunity o
  join project pj on pj."opportunityId" = o.id
  join invoice_line il on il."projectId" = pj.id
  join invoice i on i.id = il."invoiceId"
  where i.status::text not in ('DRAFT', 'CANCELLED') and o."campaignId" is not null
  group by 1
)
select
  c.id                              as campaign_id,
  c.name                            as campaign_name,
  c.status,
  c."startDate"                     as start_date,
  c."endDate"                       as end_date,
  coalesce(c."budgetAmount", 0)     as budget_amount,
  coalesce(c."actualCost", 0)       as actual_cost,
  coalesce(m.members, 0)            as members,
  coalesce(m.responses, 0)          as responses,
  coalesce(l.leads, 0)              as leads,
  coalesce(l.converted_leads, 0)    as converted_leads,
  coalesce(o.opportunities, 0)      as opportunities,
  coalesce(o.pipeline_value, 0)     as pipeline_value,
  coalesce(o.won_value, 0)          as won_value,
  coalesce(o.won_count, 0)          as won_count,
  coalesce(inv.invoiced_revenue, 0) as invoiced_revenue,
  case when coalesce(c."actualCost", 0) = 0 then null
       else round(((coalesce(o.won_value, 0) - c."actualCost") / c."actualCost") * 100, 2)
  end as roi_percent,
  case when coalesce(l.leads, 0) = 0 then null
       else round(coalesce(c."actualCost", 0) / l.leads, 2)
  end as cost_per_lead
from campaign c
left join lead_stats   l   on l.campaign_id = c.id
left join member_stats m   on m.campaign_id = c.id
left join opp_stats    o   on o.campaign_id = c.id
left join invoiced     inv on inv.campaign_id = c.id
where c."deletedAt" is null;

comment on view v_campaign_performance is
  'Per campaign: spend, members, leads, deals, pipeline, won and invoiced revenue, ROI and cost per lead. Read under the reader''s own row security.';

grant select on v_campaign_performance to authenticated;

notify pgrst, 'reload schema';
