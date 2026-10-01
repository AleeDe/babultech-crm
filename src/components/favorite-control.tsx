import { isFavorite } from "@/server/favorites";
import { FavoriteButton } from "./favorite-button";

/** The favourite star with its current state, for a record's header. Nothing for portal logins. */
export async function FavoriteControl({ entityType, entityId, label }: { entityType: string; entityId: string; label: string }) {
  const favorite = await isFavorite(entityType, entityId);
  if (favorite === null) return null;
  return <FavoriteButton entityType={entityType} entityId={entityId} label={label} favorite={favorite} />;
}
