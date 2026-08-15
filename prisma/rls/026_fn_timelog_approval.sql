-- Bulk time-log approval transitions.
--
-- Ports the approve/reject transactions in src/server/timesheets.ts. Each moves
-- a set of entries to a new approval status and writes one audit row per entry.
-- As separate requests the audit rows can be lost while the status change
-- persists, leaving approved time whose history does not say who approved it —
-- which is exactly what the approval trail exists to record.

create or replace function transition_time_logs(
  p_ids           uuid[],
  p_from_statuses text[],
  p_to_status     text,
  p_actor_id      uuid,
  p_set_approver  boolean default false
)
returns integer
language plpgsql
as $$
declare
  v_rec   record;
  v_count integer := 0;
begin
  for v_rec in
    select id, "approvalStatus"::text as status
    from time_log
    where id = any(p_ids)
      and "approvalStatus"::text = any(p_from_statuses)
    for update
  loop
    update time_log
    set "approvalStatus" = p_to_status::"TimeApprovalStatus",
        "approvedById" = case when p_set_approver then p_actor_id else "approvedById" end,
        "approvedAt"   = case when p_set_approver then now() else "approvedAt" end,
        "updatedAt" = now()
    where id = v_rec.id;

    insert into audit_history (
      id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
      "changedById", source, "changedAt"
    ) values (
      gen_random_uuid(), 'TimeLog', v_rec.id, 'approvalStatus', v_rec.status,
      p_to_status, p_actor_id, 'UI', now()
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
