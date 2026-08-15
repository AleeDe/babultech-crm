-- Contact creation/update with the "one primary per account" rule.
--
-- Ports the prisma.$transaction blocks in src/server/crm.ts (createContact,
-- updateContact). Demoting the existing primary and promoting the new one must
-- be atomic: as two HTTP calls, a failure between them leaves an account with
-- either two primary contacts or none.

create or replace function create_contact(
  p_payload jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_account_id uuid := nullif(p_payload->>'accountId', '')::uuid;
  v_is_primary boolean := coalesce((p_payload->>'isPrimary')::boolean, false);
begin
  if v_is_primary and v_account_id is not null then
    update contact
    set "isPrimary" = false, "updatedAt" = now()
    where "accountId" = v_account_id and "isPrimary" = true;
  end if;

  return create_record('contact', p_payload);
end;
$$;

create or replace function update_contact(
  p_id       uuid,
  p_payload  jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  v_account_id uuid := nullif(p_payload->>'accountId', '')::uuid;
  v_is_primary boolean := coalesce((p_payload->>'isPrimary')::boolean, false);
begin
  if v_is_primary and v_account_id is not null then
    -- Exclude self: promoting a contact that is already primary must not
    -- demote it before the update runs.
    update contact
    set "isPrimary" = false, "updatedAt" = now()
    where "accountId" = v_account_id and "isPrimary" = true and id <> p_id;
  end if;

  return update_record('contact', p_id, p_payload, 'Contact', p_actor_id);
end;
$$;
