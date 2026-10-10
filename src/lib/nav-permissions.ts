/**
 * Permission matching that runs on the client.
 *
 * `can()` in lib/authz takes a SessionUser and lives in a module that reaches
 * for the service-role client, so it cannot cross into a "use client" bundle.
 * The matching rule itself is pure string work, so it is factored out here and
 * both sides use it — the server through `can()`, the navigation through
 * `holds()` with the permission array the layout passes down.
 *
 * Keeping one implementation matters more than the few lines it saves: a nav
 * that computed visibility differently from the server would either hide a page
 * the user may open, or show one that refuses on arrival.
 */
/**
 * The CRM Admin grant: every permission except the two only a Super Admin
 * holds. A grant rather than a list, so a permission added later reaches CRM
 * Admins too. Mirrored by app_grant_covers() in the database.
 */
export const ALL_BUT_DELETE = "all:except-delete";
export const SUPER_ADMIN_ONLY: readonly string[] = ["record:delete", "role:manage"];

export function holds(permissions: string[], permission: string): boolean {
  if (permissions.includes("*")) return true;
  if (permissions.includes(ALL_BUT_DELETE) && !SUPER_ADMIN_ONLY.includes(permission)) return true;
  if (permissions.includes(permission)) return true;

  const [entity, action] = permission.split(":");
  return (
    permissions.includes(`${entity}:*`) || permissions.includes(`*:${action}`)
  );
}

/** True when the user holds at least one of `required` (empty means "everyone"). */
export function holdsAny(permissions: string[], required?: string[]): boolean {
  if (!required || required.length === 0) return true;
  return required.some((p) => holds(permissions, p));
}
