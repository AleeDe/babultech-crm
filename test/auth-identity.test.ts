/**
 * Sign-in needs both halves of a user's identity to exist and agree.
 *
 * An account lives in two places: the `app_user` profile row, and the Supabase
 * Auth user that issues the JWT. NextAuth checks the bcrypt hash on the first,
 * then signs in to the second so the request carries a JWT and RLS lets the
 * user read anything (src/lib/auth.ts).
 *
 * When only the profile exists the account looks completely correct in every
 * admin screen and cannot sign in — the first check passes and the second
 * fails. createUser() had exactly that bug: it wrote the profile and never
 * created the auth user, so every account added through the UI was born
 * unusable.
 *
 * These tests assert the invariant rather than the fix, so they would also
 * catch a future write path that creates a profile without an auth user.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type User } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

interface Profile {
  id: string;
  email: string;
  status: string;
  deletedAt: string | null;
}

let profiles: Profile[] = [];
let authUsers: User[] = [];

beforeAll(async () => {
  const { data, error } = await db
    .from("app_user")
    .select("id, email, status, deletedAt")
    .is("deletedAt", null);

  if (error) throw new Error(`Could not read app_user: ${error.message}`);
  profiles = (data ?? []) as Profile[];

  const { data: list, error: authError } = await db.auth.admin.listUsers({ perPage: 1000 });
  if (authError) throw new Error(`Could not list auth users: ${authError.message}`);
  authUsers = list.users;
});

describe("account identity", () => {
  it("gives every live profile a Supabase Auth user", () => {
    const authIds = new Set(authUsers.map((u) => u.id));
    const orphans = profiles.filter((p) => !authIds.has(p.id));

    expect(
      orphans.map((o) => o.email),
      "these profiles have no auth user and cannot sign in — " +
        "run scripts/repair-auth-users.mjs",
    ).toEqual([]);
  });

  it("keeps the two ids identical for a given address", () => {
    // ownerUserId, app_visible_owner_ids() and the audit trail all assume
    // auth.users.id === app_user.id. Two ids for one person means the session
    // owns none of that person's rows.
    const authByEmail = new Map(
      authUsers.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u.id]),
    );

    const mismatched = profiles
      .filter((p) => {
        const authId = authByEmail.get(p.email.toLowerCase());
        return authId !== undefined && authId !== p.id;
      })
      .map((p) => p.email);

    expect(
      mismatched,
      "the auth user and the profile carry different ids for these addresses",
    ).toEqual([]);
  });

  it("matches every profile address to the auth user's address", () => {
    // Login looks the account up by email in both stores, so an address
    // changed in one and not the other locks the user out.
    const authById = new Map(authUsers.map((u) => [u.id, u.email?.toLowerCase() ?? null]));

    const drifted = profiles
      .filter((p) => authById.has(p.id) && authById.get(p.id) !== p.email.toLowerCase())
      .map((p) => `${p.email} (auth has ${authById.get(p.id)})`);

    expect(drifted, "profile and auth addresses disagree").toEqual([]);
  });
});
