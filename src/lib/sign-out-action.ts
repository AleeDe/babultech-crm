"use server";

import { signOut } from "./auth";

/**
 * Sign out as a server action.
 *
 * The shells previously posted a bare form to /api/auth/signout, which
 * NextAuth v5 rejects with MissingCSRF because the form carried no token.
 * Going through the action means the framework supplies and checks the token
 * itself, and the events.signOut handler in lib/auth.ts still runs to end the
 * Supabase session alongside the NextAuth one.
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
