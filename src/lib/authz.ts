import { cache } from "react";
import { supabaseServer, supabaseAdmin } from "./supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The subset of the Supabase client these helpers use. Narrow on purpose: it
 * lets a test pass a service-role client (no cookies, no request scope) without
 * needing the full generic signature to line up.
 */
type SupabaseLike = Pick<SupabaseClient, "from">;

/**
 * Row-level authorization (spec §14.2: "row-level authorization based on role,
 * team, ownership and department; do not rely only on front-end hiding").
 *
 * Every list query in src/server/* passes its results through a scope filter
 * built here, so a salesperson never sees another rep's pipeline unless their
 * role grants a wider dataScope.
 */

export type DataScope = "OWN" | "TEAM" | "DEPARTMENT" | "ALL";

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  roleName: string;
  dataScope: DataScope;
  permissions: string[];
  departmentId: string | null;
  teamIds: string[];
  /**
   * Set only for external partner portal logins. Its presence is what makes a
   * user external: the internal app bounces them out, and every portal query
   * scopes through it. Never take this from a URL — only from the session.
   */
  partnerId: string | null;
}

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Throws if there is no session. Use in every server action and page.
 *
 * Identity comes from Supabase Auth; the profile (role, department, teams,
 * partner link) is read from app_user, which shares its id with auth.users.
 *
 * Wrapped in React's `cache()` at the bottom of this block, so the work below
 * happens once per request no matter how many times it is called. It is called
 * a lot: rendering one lead detail page went through here four times — the page
 * itself, plus listNotes, listDocuments and getLead — and each pass made two
 * network round trips, one to Supabase Auth for `getUser()` and one to
 * `app_user` for the profile. Eight sequential round trips before a single row
 * of the actual page was fetched, on every navigation and after every action.
 *
 * Identity comes from Supabase Auth alone.
 *
 * `cache()` is per-request and per-render, so this is not a session cache:
 * nothing survives into the next request, and a user whose role changes sees it
 * on their next navigation. The security properties are unchanged.
 */
async function loadUser(): Promise<SessionUser> {
  const db = await supabaseServer();

  // Supabase Auth is the only identity provider, and auth.users.id ===
  // app_user.id, so the verified user id keys the profile lookup directly.
  const {
    data: { user: supabaseUser },
  } = await db.auth.getUser();

  const userId = supabaseUser?.id ?? null;

  if (!userId) throw new AuthorizationError("Not signed in.");

  //
  // This lookup joins security_role, which deliberately has no SELECT policy —
  // only the SECURITY DEFINER helpers read it. Through the anon client the
  // `!inner` join therefore matches nothing and the whole row disappears, so
  // even a correctly signed-in user reads as "not active".
  //
  // Using the service role here is safe and is not a hole in row security:
  // `userId` comes from a verified session (a Supabase JWT or a NextAuth
  // cookie), never from user input, and the query is pinned to that single id.
  // Every *data* query still runs through the caller's own client, where RLS
  // applies.
  const profileDb = supabaseAdmin();

  const { data: user, error } = await profileDb
    .from("app_user")
    .select(
      `id, fullName, email, status, deletedAt, departmentId, partnerId,
       role:security_role!inner ( name, dataScope, permissions ),
       teamMemberships:team_member ( teamId )`,
    )
    .eq("id", userId)
    .single();

  if (error || !user || user.status !== "ACTIVE" || user.deletedAt) {
    throw new AuthorizationError("Account is not active.");
  }

  // PostgREST returns an embedded to-one relation as an object, but the
  // generated types widen it to an array. Normalise before reading.
  const role = (Array.isArray(user.role) ? user.role[0] : user.role) as {
    name: string;
    dataScope: string;
    permissions: string[];
  };

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    roleName: role.name,
    dataScope: role.dataScope as DataScope,
    permissions: role.permissions,
    departmentId: user.departmentId,
    teamIds: (user.teamMemberships ?? []).map((m: { teamId: string }) => m.teamId),
    partnerId: user.partnerId,
  };
}

export const requireUser: () => Promise<SessionUser> = cache(loadUser);

/**
 * Permission strings are "<entity>:<action>", with "*" wildcards allowed,
 * e.g. "opportunity:*", "*:read", "*".
 */
export function can(user: SessionUser, permission: string): boolean {
  if (user.permissions.includes("*")) return true;
  if (user.permissions.includes(permission)) return true;

  const [entity, action] = permission.split(":");
  return (
    user.permissions.includes(`${entity}:*`) ||
    user.permissions.includes(`*:${action}`)
  );
}

export async function requirePermission(permission: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) {
    throw new AuthorizationError(`Missing permission: ${permission}`);
  }
  return user;
}

/**
 * The server-action counterpart to `requirePermission`.
 *
 * Actions return an `ActionResult` to the browser rather than throwing, because
 * a thrown error in an action surfaces as an unhandled rejection with no
 * message the user can act on. This returns the same refusal as a value, so the
 * caller can render it in the form it came from.
 *
 * `permission` is optional: omit it to require nothing more than a live session.
 */
export async function authorize(
  permission?: string,
): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  let user: SessionUser;
  try {
    user = await requireUser();
  } catch {
    return { ok: false, error: "Your session has ended. Sign in again and retry." };
  }

  if (permission && !can(user, permission)) {
    return {
      ok: false,
      error: "Your role does not allow this. Ask an administrator if you need it.",
    };
  }

  return { ok: true, user };
}

/**
 * Builds the WHERE fragment that limits rows to what this user may see.
 * `ownerField` is the record's owning-user column (varies by entity).
 */
export async function scopeFilter(
  user: SessionUser,
  ownerField = "ownerUserId",
  client?: SupabaseLike,
): Promise<Record<string, unknown>> {
  if (user.dataScope === "ALL") return {};

  // The client is injectable so this stays testable: supabaseServer() reads
  // cookies(), which only exists inside a request. Tests and background jobs
  // pass their own client instead.
  // Same RLS consideration as requireUser: without a Supabase JWT the anon
  // client cannot read app_user/team_member. Service role for the lookup.
  const db = client ?? supabaseAdmin();

  if (user.dataScope === "DEPARTMENT") {
    // Follows the reporting line, not the department roster: self, direct
    // reports, and everyone beneath them. Authority flows down the org chart,
    // so peers cannot see each other and nobody sees their own manager.
    //
    // Mirrors app_visible_owner_ids() in
    // supabase/migrations/20260818000003_hierarchical_scope.sql. If the two
    // ever disagree, RLS wins and the list silently loses rows — keep them
    // together.
    const { data: staff } = await db
      .from("app_user")
      .select("id, managerUserId")
      .is("deletedAt", null);

    const childrenOf = new Map<string, string[]>();
    for (const row of staff ?? []) {
      if (!row.managerUserId) continue;
      const siblings = childrenOf.get(row.managerUserId) ?? [];
      siblings.push(row.id);
      childrenOf.set(row.managerUserId, siblings);
    }

    // Breadth-first with a seen set, so a manager cycle introduced by a direct
    // database edit terminates rather than looping.
    const visible = new Set<string>([user.id]);
    const queue = [user.id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const child of childrenOf.get(current) ?? []) {
        if (visible.has(child)) continue;
        visible.add(child);
        queue.push(child);
      }
    }

    return { [ownerField]: { in: [...visible] } };
  }

  if (user.dataScope === "TEAM") {
    if (user.teamIds.length === 0) return { [ownerField]: user.id };
    const { data: teammates } = await db
      .from("team_member")
      .select("userId")
      .in("teamId", user.teamIds);
    const ids = Array.from(
      new Set([user.id, ...(teammates ?? []).map((t) => t.userId)]),
    );
    return { [ownerField]: { in: ids } };
  }

  // OWN
  return { [ownerField]: user.id };
}

/** Convenience wrapper: fetch the session and its scope filter in one call. */
export async function scopedContext(
  ownerField = "ownerUserId",
  client?: SupabaseLike,
) {
  const user = await requireUser();
  const where = await scopeFilter(user, ownerField, client);
  return { user, where };
}

export const PERMISSIONS = {
  // Sales
  LEAD_READ: "lead:read",
  LEAD_WRITE: "lead:write",
  ACCOUNT_READ: "account:read",
  ACCOUNT_WRITE: "account:write",
  OPPORTUNITY_READ: "opportunity:read",
  OPPORTUNITY_WRITE: "opportunity:write",
  QUOTATION_APPROVE: "quotation:approve",
  CONTRACT_WRITE: "contract:write",
  // Partner
  PARTNER_READ: "partner:read",
  PARTNER_WRITE: "partner:write",
  COMMISSION_READ: "commission:read",
  COMMISSION_WRITE: "commission:write",
  COMMISSION_APPROVE: "commission:approve",
  PAYOUT_APPROVE: "payout:approve",
  // Support / delivery / finance
  CASE_READ: "case:read",
  CASE_WRITE: "case:write",
  PROJECT_READ: "project:read",
  PROJECT_WRITE: "project:write",
  TIME_APPROVE: "time:approve",
  INVOICE_READ: "invoice:read",
  INVOICE_WRITE: "invoice:write",
  INVOICE_APPROVE: "invoice:approve",
  PAYMENT_WRITE: "payment:write",
  // Admin
  ADMIN: "admin:*",
} as const;
