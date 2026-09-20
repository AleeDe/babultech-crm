import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { scopeFilter, type SessionUser } from "../src/lib/authz";

/**
 * DEPARTMENT scope follows the reporting line.
 *
 * The rule under test: a manager sees themselves and everyone beneath them,
 * however deep, and nobody sees upward or sideways. Peers reporting to the same
 * manager must not see each other.
 *
 * A temporary hierarchy is written over the real one and restored afterwards,
 * so the shape being asserted is explicit rather than whatever the database
 * happens to hold.
 */

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

type Person = { id: string; fullName: string; managerUserId: string | null };

let people: Person[] = [];
let original: Record<string, string | null> = {};

const idOf = (name: string) => people.find((p) => p.fullName.includes(name))!.id;
const nameOf = (id: string) => people.find((p) => p.id === id)!.fullName;

/** A DEPARTMENT-scope session for someone, which is what the filter reads. */
function sessionFor(name: string): SessionUser {
  return {
    id: idOf(name),
    fullName: name,
    email: "",
    roleName: "Test",
    dataScope: "DEPARTMENT",
    userType: "INTERNAL",
    contactId: null,
    customerAccountId: null,
    portalScope: "ACCOUNT",
    permissions: [],
    departmentId: null,
    teamIds: [],
    partnerId: null,
  };
}

async function visibleNames(name: string): Promise<string[]> {
  const where = await scopeFilter(sessionFor(name), "ownerUserId", db);
  const clause = where.ownerUserId as { in: string[] };
  return clause.in.map(nameOf).sort();
}

async function setManager(child: string, manager: string | null) {
  await db
    .from("app_user")
    .update({ managerUserId: manager ? idOf(manager) : null })
    .eq("id", idOf(child));
}

beforeAll(async () => {
  const { data } = await db
    .from("app_user")
    .select("id, fullName, managerUserId")
    .is("deletedAt", null);
  people = data as Person[];
  original = Object.fromEntries(people.map((p) => [p.id, p.managerUserId]));

  // Babul Tech -> { Sami -> [Ali, Hussain, Akbar], Hassan -> [Shabbir] }
  await setManager("Sami Ullah", "Babul Tech");
  await setManager("Hassan Shamsi", "Babul Tech");
  await setManager("Muhammad Ali", "Sami Ullah");
  await setManager("Muhammad Hussain", "Sami Ullah");
  await setManager("Akbar Ali", "Sami Ullah");
  await setManager("Shabbir Writes", "Hassan Shamsi");
});

afterAll(async () => {
  for (const [id, manager] of Object.entries(original)) {
    await db.from("app_user").update({ managerUserId: manager }).eq("id", id);
  }
});

describe("DEPARTMENT scope", () => {
  it("shows a manager their whole sub-tree, not just direct reports", async () => {
    const visible = await visibleNames("Babul Tech");
    expect(visible).toContain("Sami Ullah");
    // Two levels down: a report of a report.
    expect(visible).toContain("Muhammad Ali");
    expect(visible).toContain("Shabbir Writes");
    expect(visible).toHaveLength(people.length);
  });

  it("stops at the edge of a manager's own branch", async () => {
    const visible = await visibleNames("Sami Ullah");
    expect(visible).toEqual(
      ["Akbar Ali", "Muhammad Ali", "Muhammad Hussain", "Sami Ullah"].sort(),
    );
  });

  it("does not let anyone see upward", async () => {
    const visible = await visibleNames("Sami Ullah");
    expect(visible).not.toContain("Babul Tech");
  });

  it("does not let peers see each other", async () => {
    const visible = await visibleNames("Sami Ullah");
    // Hassan reports to the same manager as Sami.
    expect(visible).not.toContain("Hassan Shamsi");
    expect(visible).not.toContain("Shabbir Writes");
  });

  it("shows a leaf only themselves", async () => {
    expect(await visibleNames("Muhammad Ali")).toEqual(["Muhammad Ali"]);
  });

  it("terminates on a manager cycle rather than looping", async () => {
    await setManager("Sami Ullah", "Muhammad Ali");
    try {
      // Ali -> Sami -> Ali. Both are in the loop, so both are visible once.
      const visible = await visibleNames("Muhammad Ali");
      expect(visible).toContain("Muhammad Ali");
      expect(visible).toContain("Sami Ullah");
      expect(new Set(visible).size).toBe(visible.length);
    } finally {
      await setManager("Sami Ullah", "Babul Tech");
    }
  });

  it("falls back to self when someone has no reports and no manager", async () => {
    await setManager("Shabbir Writes", null);
    try {
      expect(await visibleNames("Shabbir Writes")).toEqual(["Shabbir Writes"]);
    } finally {
      await setManager("Shabbir Writes", "Hassan Shamsi");
    }
  });
});
