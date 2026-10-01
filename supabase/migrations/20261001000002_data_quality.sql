-- Data quality: records missing something that matters, or left alone too long.
--
-- One view, run as the person reading it (security_invoker), so each rule only
-- counts the records they may see. Each row is one record breaking one rule.

create or replace view data_quality_issue
with (security_invoker = true)
as
-- Accounts without a website.
select 'ACCOUNT_NO_WEBSITE'::text as rule, 'Account'::text as "entityType", a.id as "entityId",
       a.name::text as label, a."ownerUserId" as "ownerUserId", a."createdAt" as since
from account a
where a."deletedAt" is null and coalesce(btrim(a.website), '') = '' and a."accountType"::text in ('CUSTOMER', 'PROSPECT')
union all
-- Accounts with nobody to talk to.
select 'ACCOUNT_NO_CONTACTS', 'Account', a.id, a.name::text, a."ownerUserId", a."createdAt"
from account a
where a."deletedAt" is null and a."accountType"::text in ('CUSTOMER', 'PROSPECT')
  and not exists (select 1 from contact c where c."accountId" = a.id and c."deletedAt" is null)
union all
-- Contacts we cannot email.
select 'CONTACT_NO_EMAIL', 'Contact', c.id, (c."firstName" || ' ' || c."lastName")::text, null::uuid, c."createdAt"
from contact c
where c."deletedAt" is null and c.active and coalesce(btrim(c.email), '') = ''
union all
-- Open leads with no source, so nobody can say which channel works.
select 'LEAD_NO_SOURCE', 'Lead', l.id, (l."firstName" || ' ' || l."lastName")::text, l."ownerUserId", l."createdAt"
from lead l
where l."deletedAt" is null and l.status::text not in ('CONVERTED', 'DISQUALIFIED')
  and coalesce(btrim(l."leadSource"::text), '') = '' and coalesce(btrim(l."firstSource"), '') = ''
union all
-- Open leads nobody has touched for 14 days.
select 'LEAD_NO_ACTIVITY', 'Lead', l.id, (l."firstName" || ' ' || l."lastName")::text, l."ownerUserId",
       coalesce((select max(x."createdAt") from activity x where x."relatedEntityType" = 'Lead' and x."relatedEntityId" = l.id and x."deletedAt" is null), l."createdAt")
from lead l
where l."deletedAt" is null and l.status::text not in ('CONVERTED', 'DISQUALIFIED', 'PROSPECT')
  and l."createdAt" < now() - interval '14 days'
  and not exists (select 1 from activity x where x."relatedEntityType" = 'Lead' and x."relatedEntityId" = l.id
                    and x."deletedAt" is null and x."createdAt" >= now() - interval '14 days')
union all
-- Open deals with no expected close date.
select 'DEAL_NO_CLOSE_DATE', 'Opportunity', o.id, o.name::text, o."ownerUserId", o."createdAt"
from opportunity o
where o."deletedAt" is null and o.stage::text not in ('CLOSED_WON', 'CLOSED_LOST') and o."expectedCloseDate" is null
union all
-- Open deals that have not changed for 21 days.
select 'DEAL_STALE', 'Opportunity', o.id, o.name::text, o."ownerUserId", o."updatedAt"
from opportunity o
where o."deletedAt" is null and o.stage::text not in ('CLOSED_WON', 'CLOSED_LOST', 'ON_HOLD') and o."updatedAt" < now() - interval '21 days'
union all
-- Open cases nobody owns.
select 'CASE_NO_OWNER', 'SupportCase', s.id, (s."caseNumber" || ' ' || s.subject)::text, null::uuid, s."createdAt"
from support_case s
where s."deletedAt" is null and s.status::text not in ('RESOLVED', 'CLOSED', 'CANCELLED') and s."ownerUserId" is null
union all
-- Live projects with no project manager.
select 'PROJECT_NO_MANAGER', 'Project', p.id, p.name::text, null::uuid, p."createdAt"
from project p
where p."deletedAt" is null and p.status::text not in ('COMPLETED', 'CANCELLED') and p."projectManagerId" is null;

comment on view data_quality_issue is
  'One row per record breaking one data quality rule, read under the reader''s own row security.';

grant select on data_quality_issue to authenticated;
