"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase";
import { authorize } from "@/lib/authz";
import { holds } from "@/lib/nav-permissions";
import { recordLoginEvent } from "@/lib/auth";
import { getViewAs, VIEW_AS_COOKIE, VIEW_AS_MINUTES } from "@/lib/view-as";
import { endViewAs } from "@/lib/view-as-session";
import type { ActionResult } from "./partners";

/**
 * Starting and ending View as. See lib/view-as.ts for how a view works.
 */

/** Why someone cannot be viewed as, or null if they can. */
export async function viewAsRefusal(target: {
  id: string;
  status: string;
  deletedAt: string | null;
  permissions: string[];
}, viewerId: string): Promise<string | null> {
  if (target.id === viewerId) return "That is you.";
  if (target.status !== "ACTIVE" || target.deletedAt) return "Only an active user can be viewed as.";
  if (holds(target.permissions, "admin:users") || target.permissions.includes("*")) {
    return "Administrators cannot be viewed as.";
  }
  return null;
}

const startSchema = z.object({
  targetUserId: z.string().uuid(),
  reason: z.string().trim().min(5, "Say why, in a few words: it is kept in the security history.").max(500),
});

export async function startViewAs(input: z.infer<typeof startSchema>): Promise<ActionResult> {
  const auth = await authorize("user:view_as");
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please give a reason." };

  // No view inside a view: authorize() already refused if one were open, but a
  // stale cookie is cleared rather than trusted.
  if (await getViewAs()) return { ok: false, error: "Exit the current View as first." };

  const db = supabaseAdmin();
  const { data: target } = await db
    .from("app_user")
    .select("id, email, fullName, status, deletedAt, role:security_role!inner ( permissions )")
    .eq("id", parsed.data.targetUserId)
    .maybeSingle();
  if (!target) return { ok: false, error: "That user could not be found." };
  const role = (Array.isArray(target.role) ? target.role[0] : target.role) as { permissions: string[] };
  const refusal = await viewAsRefusal(
    { id: target.id as string, status: target.status as string, deletedAt: target.deletedAt as string | null, permissions: role?.permissions ?? [] },
    auth.user.id,
  );
  if (refusal) return { ok: false, error: refusal };

  // A one-time sign-in for them, used at once. Nothing is emailed and their
  // password is untouched.
  const { data: link, error: linkError } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: target.email as string,
  });
  const hashed = link?.properties?.hashed_token;
  if (linkError || !hashed) return { ok: false, error: `Could not start the view: ${linkError?.message ?? "no sign-in was issued"}.` };

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: hashed });
  const token = verified?.session?.access_token;
  if (verifyError || !token) return { ok: false, error: `Could not start the view: ${verifyError?.message ?? "no session"}.` };

  const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { session_id?: string; exp?: number };
  if (!claims.session_id) {
    await db.auth.admin.signOut(token, "local").catch(() => {});
    return { ok: false, error: "Could not start the view: the sign-in had no session." };
  }

  // Thirty minutes, or sooner if the issued token expires first.
  const ends = Math.min(Date.now() + VIEW_AS_MINUTES * 60_000, (claims.exp ?? Infinity) * 1000 - 30_000);
  const expiresAt = new Date(ends).toISOString();

  const { data: row, error: rowError } = await db
    .from("view_as_session")
    .insert({
      adminUserId: auth.user.id,
      targetUserId: target.id,
      reason: parsed.data.reason,
      sessionId: claims.session_id,
      expiresAt,
    })
    .select("id")
    .single();
  if (rowError || !row) {
    await db.auth.admin.signOut(token, "local").catch(() => {});
    return { ok: false, error: `Could not start the view: ${rowError?.message ?? "not recorded"}.` };
  }

  await recordLoginEvent({
    eventType: "VIEW_AS_START",
    userId: auth.user.id,
    targetUserId: target.id as string,
    reason: parsed.data.reason,
  });

  (await cookies()).set(VIEW_AS_COOKIE, JSON.stringify({ id: row.id, token }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(60, Math.floor((ends - Date.now()) / 1000)),
  });

  redirect("/");
}

/** Leaves View as and goes back to the person's user page. */
export async function exitViewAs(): Promise<void> {
  const ended = await endViewAs("Exited");
  redirect(ended ? `/users/${ended.targetUserId}` : "/");
}
