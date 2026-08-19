"use server";

import { redirect } from "next/navigation";
import { signOut } from "./auth";

/**
 * Sign out as a server action.
 *
 * A server action rather than a posted form: the shells render inside the
 * authenticated layout, and going through the action lets the Supabase client
 * clear its cookie on the response before the redirect.
 */
export async function signOutAction() {
  await signOut();
  redirect("/login");
}
