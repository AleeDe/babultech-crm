import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Supabase clients.
 *
 * Three of them, because they carry different authority and mixing them up is
 * how row security gets bypassed:
 *
 *   supabaseServer()  — acts AS the signed-in user. RLS applies. Use for
 *                       everything the app does on a user's behalf.
 *   supabaseAdmin()   — service role, RLS is BYPASSED entirely. Only for
 *                       operations that legitimately span all tenants
 *                       (seeding, background jobs, admin tooling).
 *   supabaseAnon()    — no session. Login and other pre-auth calls.
 *
 * See docs/SUPABASE-MIGRATION.md.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy it from Supabase Dashboard > Project Settings > API.`,
    );
  }
  return value;
}

/**
 * Request-scoped client bound to the caller's session cookie.
 *
 * Every query issued through this runs with the user's JWT, so the RLS policies
 * in supabase/functions-sql/ decide what rows come back. This is the default — reach for
 * anything else only with a reason.
 */
export async function supabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(requireEnv(url, "NEXT_PUBLIC_SUPABASE_URL"), requireEnv(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // Session refresh is handled by middleware instead.
        }
      },
    },
  });
}

/**
 * Service-role client. RLS DOES NOT APPLY — this sees and writes every row in
 * every table.
 *
 * Never build one in response to a user request unless the caller has already
 * been authorized for exactly that operation. Never expose the key to the
 * browser: it is read from a non-NEXT_PUBLIC_ variable so it cannot be bundled.
 */
export function supabaseAdmin(): SupabaseClient {
  const serviceKey = requireEnv(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    "SUPABASE_SERVICE_ROLE_KEY",
  );

  return createClient(requireEnv(url, "NEXT_PUBLIC_SUPABASE_URL"), serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Anonymous client for pre-authentication calls (sign-in, password reset). */
export function supabaseAnon(): SupabaseClient {
  return createClient(
    requireEnv(url, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
