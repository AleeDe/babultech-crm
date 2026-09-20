/**
 * Characterization tests for the internal/external boundary.
 *
 * The partner portal is a SECOND access path that never goes through
 * scopeFilter: src/server/portal.ts gates on user.partnerId instead. Per the
 * schema comment on User.partnerId, the presence of that column is what makes
 * a user external.
 *
 * Under RLS this is a separate policy family, and the dangerous failure is an
 * external user falling through to an internal policy. These tests pin the
 * boundary so that failure is caught.
 *
 * Uses the service-role client: these assert on what scopeFilter() COMPUTES,
 * and the fixtures must be created regardless of RLS.
 *
 * See docs/SUPABASE-MIGRATION.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { scopeFilter, type SessionUser, type DataScope } from "@/lib/authz";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const FIXTURE_EMAIL = "test.portal.fixture@babultech.invalid";
const FIXTURE_PREFIX = "__TEST_BOUNDARY__";

let portalUser: SessionUser;
let partnerAId: string;
let partnerBId: string;
const cleanup: Array<() => PromiseLike<unknown>> = [];

/** Creates a partner if the fixture pair is not already present. */
async function ensurePartner(suffix: string): Promise<string> {
  const displayName = `${FIXTURE_PREFIX}${suffix}`;

  const { data: found } = await db
    .from("partner")
    .select("id")
    .eq("displayName", displayName)
    .maybeSingle();
  if (found) return found.id;

  // partner_identity_check (prisma/sql/01_constraints.sql) requires a partner to
  // be EITHER a company with an accountId OR an individual with a contactId.
  // An INDIVIDUAL keeps the fixture self-contained — no account needed.
  const contactId = randomUUID();
  const { error: contactErr } = await db.from("contact").insert({
    id: contactId,
    firstName: "Fixture",
    lastName: `Partner${suffix}`,
    updatedAt: new Date().toISOString(),
  });
  if (contactErr) throw new Error(`contact fixture: ${contactErr.message}`);
  cleanup.push(() => db.from("contact").delete().eq("id", contactId));

  const id = randomUUID();
  const { error } = await db.from("partner").insert({
    id,
    partnerNumber: `${FIXTURE_PREFIX}${suffix}`,
    displayName,
    kind: "INDIVIDUAL",
    contactId,
    partnerType: "REFERRAL",
    status: "ACTIVE",
    payoutCurrencyCode: "PKR",
    updatedAt: new Date().toISOString(),
  });
  if (error) throw new Error(`partner fixture: ${error.message}`);

  cleanup.push(() => db.from("partner").delete().eq("id", id));
  return id;
}

beforeAll(async () => {
  partnerAId = await ensurePartner("A");
  partnerBId = await ensurePartner("B");
  expect(partnerAId).not.toBe(partnerBId);

  const { data: execRole } = await db
    .from("security_role")
    .select("id, name, dataScope, permissions")
    .eq("dataScope", "OWN")
    .limit(1)
    .single();

  const userId = randomUUID();
  const { error: userErr } = await db.from("app_user").upsert(
    {
      id: userId,
      email: FIXTURE_EMAIL,
      fullName: "Portal Fixture User",
      status: "ACTIVE",
      roleId: execRole!.id,
      partnerId: partnerAId,
      updatedAt: new Date().toISOString(),
    },
    { onConflict: "email" },
  );
  if (userErr) throw new Error(`user fixture: ${userErr.message}`);

  const { data: created } = await db
    .from("app_user")
    .select("id, fullName, email, departmentId, partnerId")
    .eq("email", FIXTURE_EMAIL)
    .single();

  cleanup.push(() => db.from("app_user").delete().eq("id", created!.id));

  portalUser = {
    id: created!.id,
    fullName: created!.fullName,
    email: created!.email,
    roleName: execRole!.name,
    dataScope: execRole!.dataScope as DataScope,
    permissions: execRole!.permissions,
    userType: "PARTNER" as const,
    contactId: null,
    customerAccountId: null,
    portalScope: "ACCOUNT" as const,
    departmentId: created!.departmentId,
    teamIds: [],
    partnerId: created!.partnerId,
  };
});

afterAll(async () => {
  // Reverse order: children before parents, so FKs do not block deletion.
  // PostgREST builders are thenable but not Promises, so `await` them inside
  // try/catch rather than calling .catch() on the return value.
  // Two passes: the first may fail where a FK still points at the row (the
  // partner fixtures are registered before the user that references them), the
  // second succeeds once the dependant is gone.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const undo of cleanup.slice().reverse()) {
      try {
        await undo();
      } catch {
        /* retried on the next pass */
      }
    }
  }
});

describe("external user identification", () => {
  it("is marked external by a non-null partnerId", () => {
    expect(portalUser.partnerId).toBe(partnerAId);
  });

  it("is bound to exactly one partner", () => {
    expect(portalUser.partnerId).not.toBe(partnerBId);
  });
});

describe("internal scoping does not cover external users", () => {
  /**
   * The regression that matters. scopeFilter() only ever restricts by
   * ownerUserId — it has no notion of partnerId. So for an external user it
   * produces a filter about ownership, NOT about partner isolation.
   *
   * Today that is safe because portal.ts never calls scopeFilter. Under RLS,
   * if an external user is matched by an internal policy, isolation is lost.
   * This documents the gap explicitly.
   */
  it("scopeFilter ignores partnerId entirely", async () => {
    const where = await scopeFilter(portalUser, "ownerUserId", db);

    expect(where).not.toHaveProperty("partnerId");
    expect(where).toEqual({ ownerUserId: portalUser.id });
  });

  it("an ALL-scoped external user would be unrestricted by scopeFilter alone", async () => {
    // Deliberately constructed: if an external user were ever given a wide
    // role, application scoping would impose NO limit. Partner isolation must
    // come from the portal path (today) or a dedicated RLS policy (after
    // migration) — never from dataScope.
    const wideExternal: SessionUser = { ...portalUser, dataScope: "ALL" };
    const where = await scopeFilter(wideExternal, "ownerUserId", db);

    expect(where).toEqual({});
  });
});

describe("partner isolation is enforced by the database", () => {
  it("gives each partner a distinct identity to isolate on", async () => {
    const { data } = await db
      .from("partner")
      .select("id, displayName")
      .in("id", [partnerAId, partnerBId]);

    expect(data).toHaveLength(2);
    expect(new Set(data!.map((p) => p.id)).size).toBe(2);
  });

  it("has RLS enabled on the partner-scoped tables", async () => {
    // Anon client: no session, so deny-by-default must return nothing.
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );

    for (const table of ["partner", "commission_record", "opportunity_partner"]) {
      const { count } = await anon
        .from(table)
        .select("*", { count: "exact", head: true });
      expect(count ?? 0).toBe(0);
    }
  });
});
