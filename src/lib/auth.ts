import { z } from "zod";
import { supabaseAdmin, supabaseServer } from "./supabase";

/**
 * Sign-in and sign-out against Supabase Auth.
 *
 * Supabase Auth is the only identity provider. It issues the JWT that
 * supabaseServer() puts on every query, so the session the user holds is the
 * same one the database authorizes against — there is no second session to keep
 * in sync.
 *
 * auth.users.id === app_user.id, so the profile lookup in lib/authz.ts keys
 * straight off the signed-in user id.
 */

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type SignInResult = { ok: true } | { ok: false; reason: string };

/**
 * Verifies credentials and starts a session.
 *
 * The password is checked by Supabase Auth, not here. The app_user row is
 * consulted only to reject accounts that are disabled or soft-deleted, which
 * Supabase Auth knows nothing about.
 */
export async function signInWithCredentials(
  email: string,
  password: string,
): Promise<SignInResult> {
  const parsed = credentialsSchema.safeParse({ email, password });
  if (!parsed.success) return { ok: false, reason: "invalid" };

  const normalizedEmail = parsed.data.email.toLowerCase();

  const db = await supabaseServer();
  const { data, error } = await db.auth.signInWithPassword({
    email: normalizedEmail,
    password: parsed.data.password,
  });

  if (error || !data.user) return { ok: false, reason: "invalid" };

  // Status and deletedAt live on app_user, so a suspended user still passes the
  // Supabase password check. Read them with the service role: at this instant
  // the cookie is set but this request's client was built before it existed,
  // and the lookup is pinned to the id Supabase just verified.
  const adminDb = supabaseAdmin();
  const { data: profile } = await adminDb
    .from("app_user")
    .select("id, status, deletedAt")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile || profile.status !== "ACTIVE" || profile.deletedAt) {
    // Do not leave a usable session behind for an account that cannot sign in.
    await db.auth.signOut();
    return { ok: false, reason: "inactive" };
  }

  await adminDb
    .from("app_user")
    .update({ lastLoginAt: new Date().toISOString() })
    .eq("id", profile.id);

  return { ok: true };
}

/** Ends the Supabase session. */
export async function signOut(): Promise<void> {
  const db = await supabaseServer();
  await db.auth.signOut();
}
