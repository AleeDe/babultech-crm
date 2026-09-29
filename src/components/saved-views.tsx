import { listSavedViews, type ListName } from "@/server/saved-views";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { SavedViewsMenu } from "./saved-views-menu";

/** The Views menu for a list's header: pick, save, make default, share. */
export async function SavedViewsControl({ entity }: { entity: ListName }) {
  const [views, user] = await Promise.all([listSavedViews(entity).catch(() => []), requireUser()]);
  return <SavedViewsMenu entity={entity} views={views} canShare={can(user, PERMISSIONS.ADMIN)} />;
}
