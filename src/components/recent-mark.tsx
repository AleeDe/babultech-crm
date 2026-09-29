import { noteRecent } from "@/server/recent";

/** Placed on a record's page: notes the visit for "recently opened". Renders nothing. */
export async function RecentMark({ entityType, entityId, label }: { entityType: string; entityId: string; label: string }) {
  await noteRecent(entityType, entityId, label);
  return null;
}
