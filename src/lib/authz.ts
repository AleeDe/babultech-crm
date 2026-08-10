import { prisma } from "./prisma";
import { auth } from "./auth";

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
}

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Throws if there is no session. Use in every server action and page. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  if (!session?.user?.id) throw new AuthorizationError("Not signed in.");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: { role: true, teamMemberships: { select: { teamId: true } } },
  });

  if (!user || user.status !== "ACTIVE" || user.deletedAt) {
    throw new AuthorizationError("Account is not active.");
  }

  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    roleName: user.role.name,
    dataScope: user.role.dataScope as DataScope,
    permissions: user.role.permissions,
    departmentId: user.departmentId,
    teamIds: user.teamMemberships.map((m) => m.teamId),
  };
}

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
): Promise<Record<string, unknown>> {
  if (user.dataScope === "ALL") return {};

  if (user.dataScope === "DEPARTMENT") {
    if (!user.departmentId) return { [ownerField]: user.id };
    const peers = await prisma.user.findMany({
      where: { departmentId: user.departmentId },
      select: { id: true },
    });
    return { [ownerField]: { in: peers.map((p) => p.id) } };
  }

  if (user.dataScope === "TEAM") {
    if (user.teamIds.length === 0) return { [ownerField]: user.id };
    const teammates = await prisma.teamMember.findMany({
      where: { teamId: { in: user.teamIds } },
      select: { userId: true },
    });
    const ids = Array.from(new Set([user.id, ...teammates.map((t) => t.userId)]));
    return { [ownerField]: { in: ids } };
  }

  // OWN
  return { [ownerField]: user.id };
}

/** Convenience wrapper: fetch the session and its scope filter in one call. */
export async function scopedContext(ownerField = "ownerUserId") {
  const user = await requireUser();
  const where = await scopeFilter(user, ownerField);
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
