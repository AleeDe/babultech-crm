"use server";

import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { PERMISSIONS, authorize, can } from "@/lib/authz";
import { issuePasswordLink, readPasswordLink, redeemPasswordLink, type IssuedLink } from "@/lib/password-links";
import type { ActionResult } from "./partners";

/**
 * Sends someone a link to set their own password, from their user page.
 * The link comes back too, to pass on by hand when the email cannot be sent.
 */
export async function sendPasswordLink(userId: string): Promise<ActionResult<IssuedLink>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return auth;
  const { data: user } = await supabaseAdmin().from("app_user").select("id, status, security_role ( permissions )").eq("id", userId).is("deletedAt", null).maybeSingle();
  if (!user) return { ok: false, error: "User not found." };
  const role = (Array.isArray(user.security_role) ? user.security_role[0] : user.security_role) as { permissions?: string[] } | null;
  if (role?.permissions?.includes("*") && !can(auth.user, PERMISSIONS.ROLE_MANAGE)) {
    return { ok: false, error: "Only the Super Admin can reset the Super Admin's password." };
  }
  if (user.status === "SUSPENDED") return { ok: false, error: "This login is suspended. Make it active first." };
  try {
    const issued = await issuePasswordLink({ userId, purpose: "RESET", createdBy: auth.user });
    revalidatePath(`/users/${userId}`);
    return { ok: true, data: issued };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the link." };
  }
}

/** The latest link sent to a login and what became of it, for their user page. */
export async function getLatestPasswordLink(userId: string) {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return null;
  const db = supabaseAdmin();
  const [{ data: link }, { data: mail }] = await Promise.all([
    db.from("password_link").select("purpose, createdAt, expiresAt, usedAt").eq("userId", userId).order("createdAt", { ascending: false }).limit(1).maybeSingle(),
    db.from("email").select("status, sentReceivedAt").eq("relatedEntityType", "User").eq("relatedEntityId", userId).order("sentReceivedAt", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!link) return null;
  const sentAt = String(link.createdAt);
  // The email row written for this link, if there was one (same moment, give or take).
  const emailed = mail && Math.abs(Date.parse(String(mail.sentReceivedAt)) - Date.parse(sentAt)) < 120_000 ? String(mail.status) : null;
  return {
    purpose: String(link.purpose),
    sentAt,
    expiresAt: String(link.expiresAt),
    usedAt: link.usedAt ? String(link.usedAt) : null,
    emailStatus: emailed,
  };
}

/** Public: whose link this is, for the page that opens from it. */
export async function getPasswordLinkContext(token: string) {
  const link = await readPasswordLink(token);
  return link ? { fullName: link.fullName, email: link.email, purpose: link.purpose } : null;
}

/** Public: sets the password through the link. The token is the only key. */
export async function setPasswordWithLink(token: string, password: string): Promise<ActionResult<{ email: string; active: boolean }>> {
  const result = await redeemPasswordLink(String(token ?? ""), String(password ?? ""));
  return result.ok ? { ok: true, data: { email: result.email, active: result.active } } : result;
}
