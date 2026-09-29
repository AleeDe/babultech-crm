import { cache } from "react";
import { cookies } from "next/headers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin, supabaseSession } from "./supabase";

/**
 * View as: seeing the CRM, or a portal, as another person sees it.
 *
 * An administrator with user:view_as starts one from a user's page, with a
 * reason. The app has Supabase Auth issue a sign-in for that person - no
 * password is seen or changed - and keeps its access token in an httpOnly
 * cookie for 30 minutes. While the cookie is valid, every query runs on that
 * token, so row security returns exactly what that person would see.
 *
 * It is read-only, and that is enforced twice: loadUser() in authz.ts refuses
 * every server action while a view is open, and the database refuses any write
 * made on the view's token (app_refuse_view_as_writes, in
 * supabase/migrations/20260929000002_login_history_and_view_as.sql).
 *
 * The cookie alone is not enough. It only counts while the administrator's own
 * session is still the one that started it, the session is recorded, not ended
 * and not expired - so a cookie copied to another browser is worthless.
 */

export const VIEW_AS_COOKIE = "bt-view-as";
export const VIEW_AS_MINUTES = 30;

export interface ViewAsState {
  sessionRowId: string;
  adminUserId: string;
  adminName: string;
  targetUserId: string;
  targetName: string;
  startedAt: string;
  expiresAt: string;
  accessToken: string;
}

export class ViewAsReadOnlyError extends Error {
  constructor(name: string) {
    super(`You are viewing as ${name}, so nothing can be changed. Exit View as to make changes.`);
    this.name = "ViewAsReadOnlyError";
  }
}

async function loadViewAs(): Promise<ViewAsState | null> {
  let raw: string | undefined;
  try {
    raw = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: { id?: string; token?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed.id || !parsed.token) return null;

  // The administrator's own session, from their own cookie.
  const { data: claims } = await (await supabaseSession()).auth.getClaims();
  const adminId = (claims?.claims?.sub as string | undefined) ?? null;
  if (!adminId) return null;

  const { data: row } = await supabaseAdmin()
    .from("view_as_session")
    .select(`id, adminUserId, targetUserId, startedAt, expiresAt, endedAt,
      admin:app_user!view_as_session_adminUserId_fkey ( fullName ),
      target:app_user!view_as_session_targetUserId_fkey ( fullName )`)
    .eq("id", parsed.id)
    .maybeSingle();
  if (!row || row.adminUserId !== adminId || row.endedAt) return null;
  if (new Date(`${String(row.expiresAt).replace(/Z?$/, "Z")}`).getTime() <= Date.now()) return null;

  const pick = (v: unknown) => ((Array.isArray(v) ? v[0] : v) as { fullName?: string } | null)?.fullName ?? "";
  return {
    sessionRowId: row.id as string,
    adminUserId: row.adminUserId as string,
    adminName: pick(row.admin),
    targetUserId: row.targetUserId as string,
    targetName: pick(row.target),
    startedAt: row.startedAt as string,
    expiresAt: row.expiresAt as string,
    accessToken: parsed.token,
  };
}

/** The open View as session for this request, if any. Once per request. */
export const getViewAs: () => Promise<ViewAsState | null> = cache(loadViewAs);

/** A client that acts as the person being viewed. Row security applies. */
export function viewAsClient(state: ViewAsState): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${state.accessToken}` } },
  });
}
