import { getFollowState } from "@/server/notifications";
import type { FollowableType } from "@/lib/notification-kinds";
import { FollowButton } from "./follow-button";

/** The Follow button with whether you already follow, for a record's header. */
export async function FollowControl({ entityType, entityId }: { entityType: FollowableType; entityId: string }) {
  const state = await getFollowState(entityType, entityId).catch(() => null);
  if (!state) return null;
  return <FollowButton entityType={entityType} entityId={entityId} following={state.following} />;
}
