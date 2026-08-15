/**
 * Characterization tests for row-level scoping.
 *
 * These pin the CURRENT behavior of src/lib/authz.ts so the Supabase/RLS
 * migration can be checked against it. They must pass identically before the
 * migration (app-enforced scoping) and after it (database-enforced RLS).
 *
 * They deliberately assert on *who is excluded*, not just who is included — a
 * scoping regression shows up as extra visible rows, never as an error.
 *
 * See docs/SUPABASE-MIGRATION.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { scopeFilter, can, type SessionUser, type DataScope } from "@/lib/authz";

/**
 * Service-role client: bypasses RLS, which is what these tests need — they
 * assert on what scopeFilter() COMPUTES, not on what RLS returns. It also has
 * no cookie dependency, so it works outside a Next.js request scope.
 */
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

/** Builds a SessionUser from the database, the same shape requireUser() returns. */
async function sessionUserFor(email: string): Promise<SessionUser> {
  const { data: user, error } = await db
    .from("app_user")
    .select(
      `id, fullName, email, departmentId, partnerId,
       role:security_role!inner ( name, dataScope, permissions ),
       teamMemberships:team_member ( teamId )`,
    )
    .eq("email", email)
    .single();

  if (error || !user) throw new Error(`No such user: ${email} (${error?.message})`);

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

/** Resolves a scope filter to the set of owner-user-ids it permits. */
async function visibleOwnerIds(user: SessionUser): Promise<Set<string> | "ALL"> {
  const where = await scopeFilter(user, "ownerUserId", db);

  if (Object.keys(where).length === 0) return "ALL";

  const clause = where.ownerUserId as string | { in: string[] };
  if (typeof clause === "string") return new Set([clause]);
  return new Set(clause.in);
}

let admin: SessionUser;
let manager: SessionUser;
let exec: SessionUser;

beforeAll(async () => {
  admin = await sessionUserFor("admin@babultech.com");
  manager = await sessionUserFor("sales.manager@babultech.com");
  exec = await sessionUserFor("sales.exec@babultech.com");
});

describe("seeded fixtures", () => {
  it("have the data scopes the tests assume", () => {
    expect(admin.dataScope).toBe("ALL");
    expect(manager.dataScope).toBe("TEAM");
    expect(exec.dataScope).toBe("OWN");
  });

  it("are internal users (no partnerId)", () => {
    expect(admin.partnerId).toBeNull();
    expect(manager.partnerId).toBeNull();
    expect(exec.partnerId).toBeNull();
  });
});

describe("OWN scope", () => {
  it("sees only its own records", async () => {
    const visible = await visibleOwnerIds(exec);
    expect(visible).not.toBe("ALL");
    expect(visible).toEqual(new Set([exec.id]));
  });

  it("cannot see another rep's records", async () => {
    const visible = await visibleOwnerIds(exec);
    expect(visible).not.toBe("ALL");
    expect((visible as Set<string>).has(manager.id)).toBe(false);
    expect((visible as Set<string>).has(admin.id)).toBe(false);
  });
});

describe("TEAM scope", () => {
  it("includes the user themselves", async () => {
    const visible = await visibleOwnerIds(manager);
    expect(visible).not.toBe("ALL");
    expect((visible as Set<string>).has(manager.id)).toBe(true);
  });

  it("includes teammates", async () => {
    const { data: teammates } = await db
      .from("team_member")
      .select("userId")
      .in("teamId", manager.teamIds);
    const visible = (await visibleOwnerIds(manager)) as Set<string>;

    for (const { userId } of teammates ?? []) {
      expect(visible.has(userId)).toBe(true);
    }
  });

  it("does not widen to the whole company", async () => {
    const visible = await visibleOwnerIds(manager);
    expect(visible).not.toBe("ALL");

    const { data: everyone } = await db.from("app_user").select("id");
    const outsiders = (everyone ?? []).filter((u) => !(visible as Set<string>).has(u.id));

    // The fixture set must actually contain someone outside the team, or this
    // test proves nothing.
    expect(outsiders.length).toBeGreaterThan(0);
  });

  it("falls back to OWN when the user is on no team", async () => {
    const teamless: SessionUser = { ...manager, teamIds: [] };
    const visible = await visibleOwnerIds(teamless);
    expect(visible).toEqual(new Set([manager.id]));
  });
});

describe("DEPARTMENT scope", () => {
  it("is limited to department peers", async () => {
    const deptUser: SessionUser = { ...exec, dataScope: "DEPARTMENT" };
    expect(deptUser.departmentId).not.toBeNull();

    const { data: peers } = await db
      .from("app_user")
      .select("id")
      .eq("departmentId", deptUser.departmentId!);
    const visible = (await visibleOwnerIds(deptUser)) as Set<string>;

    expect(visible).not.toBe("ALL");
    expect(visible).toEqual(new Set((peers ?? []).map((p) => p.id)));
  });

  it("falls back to OWN when the user has no department", async () => {
    const orphan: SessionUser = { ...exec, dataScope: "DEPARTMENT", departmentId: null };
    const visible = await visibleOwnerIds(orphan);
    expect(visible).toEqual(new Set([exec.id]));
  });
});

describe("ALL scope", () => {
  it("applies no row restriction", async () => {
    const where = await scopeFilter(admin, "ownerUserId", db);
    expect(where).toEqual({});
  });
});

describe("permission matching", () => {
  it("grants the admin wildcard everything", () => {
    expect(can(admin, "opportunity:read")).toBe(true);
    expect(can(admin, "payout:approve")).toBe(true);
  });

  it("refuses a permission the exec's role does not carry", () => {
    expect(can(exec, "payout:approve")).toBe(false);
  });

  it("honours entity and action wildcards without granting everything", () => {
    const scoped: SessionUser = { ...exec, permissions: ["opportunity:*", "*:read"] };
    expect(can(scoped, "opportunity:write")).toBe(true);
    expect(can(scoped, "invoice:read")).toBe(true);
    expect(can(scoped, "invoice:write")).toBe(false);
  });
});
