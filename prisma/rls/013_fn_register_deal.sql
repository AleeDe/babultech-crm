-- Atomic partner deal registration.
--
-- Ports the prisma.$transaction in src/server/portal.ts (registerDeal): create
-- the lead, then create the review task that puts it in front of a human.
--
-- Both must succeed together. If the activity insert failed on its own, the
-- lead would exist with nobody assigned to review it — a registration that
-- silently sits in a list forever, which is exactly the failure the task
-- exists to prevent.
--
-- SECURITY INVOKER: the caller's RLS still applies. Authorization (an active
-- partner, unexpired agreement) is checked in the application before this runs.

create or replace function register_partner_deal(
  p_partner_id      uuid,
  p_owner_id        uuid,
  p_first_name      text,
  p_last_name       text,
  p_company         text,
  p_email           text,
  p_phone           text,
  p_industry        text,
  p_estimated_value numeric,
  p_follow_up       date,
  p_description     text,
  p_activity_subject text,
  p_activity_body   text,
  p_priority        text,
  p_due_at          timestamp
)
returns table (id uuid, "leadNumber" text)
language plpgsql
as $$
declare
  v_lead_id uuid := gen_random_uuid();
  v_number  text;
begin
  v_number := next_sequence_number('Lead');

  insert into lead (
    id, "leadNumber", "firstName", "lastName", "companyName", email, phone,
    industry, "leadSource", "referredByPartnerId", "ownerUserId", status,
    "estimatedValue", "nextFollowUpAt", description, "createdAt", "updatedAt"
  ) values (
    v_lead_id, v_number, p_first_name, p_last_name, p_company,
    nullif(p_email, ''), p_phone, p_industry, 'Partner', p_partner_id,
    p_owner_id, 'NEW', p_estimated_value, p_follow_up, p_description,
    now(), now()
  );

  insert into activity (
    id, "activityType", subject, description, "ownerUserId",
    "relatedEntityType", "relatedEntityId", "dueAt", priority, status,
    "createdAt", "updatedAt"
  ) values (
    gen_random_uuid(), 'TASK', p_activity_subject, p_activity_body, p_owner_id,
    'Lead', v_lead_id, p_due_at, p_priority::"Priority", 'OPEN',
    now(), now()
  );

  return query select v_lead_id, v_number;
end;
$$;
