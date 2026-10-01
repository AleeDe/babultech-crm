"use server";

import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { authorize, requireUser } from "@/lib/authz";
import { sendPortalWelcome } from "./portal-invite";
import type { ActionResult } from "./partners";

/**
 * A portal Admin's team: the logins at their own company - their partner, or
 * their customer account. Who counts as their company is decided by the
 * database (portal_team), from the session, never from anything sent.
 */

export interface TeamMember {
  id: string;
  fullName: string;
  email: string;
  portalRole: "ADMIN" | "USER";
  status: string;
  lastLoginAt: string | null;
  isMe: boolean;
}

async function requirePortalLogin() {
  const me = await requireUser();
  if (me.userType !== "PARTNER" && me.userType !== "CUSTOMER") throw new Error("This is for partner and customer logins.");
  return me;
}

export async function getPortalTeam(): Promise<TeamMember[]> {
  await requirePortalLogin();
  const db = await supabaseServer();
  const { data, error } = await db.rpc("portal_team");
  if (error) throw new Error(`Could not load your team: ${error.message}`);
  return (data ?? []) as TeamMember[];
}

export async function setPortalMember(userId: string, role: "ADMIN" | "USER", active: boolean): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.user.portalRole !== "ADMIN") return { ok: false, error: "Only an Admin can change your company's logins." };
  const db = await supabaseServer();
  const { error } = await db.rpc("portal_set_member", { p_user: userId, p_role: role, p_active: active });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

const inviteSchema = z.object({
  firstName: z.string().trim().min(1, "Give their first name.").max(100),
  lastName: z.string().trim().min(1, "Give their last name.").max(100),
  email: z.string().trim().toLowerCase().email("That is not an email address.").max(255),
  role: z.enum(["ADMIN", "USER"]),
});

/**
 * Gives a colleague a login to the same portal, at the same company. They are
 * emailed a password, as when our team grants access.
 */
export async function invitePortalColleague(input: z.infer<typeof inviteSchema>): Promise<ActionResult<{ emailed: boolean }>> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  const me = auth.user;
  if (me.userType !== "PARTNER" && me.userType !== "CUSTOMER") return { ok: false, error: "This is for partner and customer logins." };
  if (me.portalRole !== "ADMIN") return { ok: false, error: "Only an Admin can invite colleagues." };
  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the details." };
  const d = parsed.data;
  const admin = supabaseAdmin();

  const { data: clash } = await admin.from("app_user").select("id").ilike("email", d.email).is("deletedAt", null).maybeSingle();
  if (clash) return { ok: false, error: "That email already has a login." };

  const partner = me.userType === "PARTNER";
  let accountId: string | null = null;
  if (partner) {
    const { data: p } = await admin.from("partner").select("accountId, status").eq("id", me.partnerId!).maybeSingle();
    if (!p || p.status !== "ACTIVE") return { ok: false, error: "Only an active partnership can add logins." };
    accountId = (p.accountId as string | null) ?? null;
  } else {
    accountId = me.customerAccountId;
    if (!accountId) return { ok: false, error: "Your login has no company to add colleagues to." };
  }

  // The person, as a contact at the company: an existing one with that address, or a new one.
  let contactId: string | null = null;
  if (accountId) {
    const { data: existing } = await admin
      .from("contact")
      .select("id")
      .eq("accountId", accountId)
      .ilike("email", d.email)
      .is("deletedAt", null)
      .maybeSingle();
    contactId = (existing?.id as string | undefined) ?? null;
  }
  if (!contactId) {
    const { data: contact, error } = await admin
      .from("contact")
      .insert({
        id: crypto.randomUUID(),
        accountId,
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        ...(partner ? { sourcePartnerId: me.partnerId } : {}),
        updatedAt: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !contact) {
      return { ok: false, error: /duplicate|already/i.test(error?.message ?? "") ? "That person is already on file. Ask us to give them access." : error?.message ?? "Could not add them." };
    }
    contactId = contact.id as string;
  }
  if (partner) {
    await admin.from("partner_contact").upsert(
      { id: crypto.randomUUID(), partnerId: me.partnerId, contactId, role: "Portal user", isPrimary: false, updatedAt: new Date().toISOString() },
      { onConflict: "partnerId,contactId", ignoreDuplicates: true },
    );
  }

  const { data: role } = await admin.from("security_role").select("id").eq("name", partner ? "Partner" : "Customer").maybeSingle();
  if (!role) return { ok: false, error: "The portal role is missing. Please ask us to set it up." };

  const password = randomBytes(12).toString("base64url");
  const fullName = `${d.firstName} ${d.lastName}`;
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email: d.email,
    password,
    email_confirm: true,
    user_metadata: { fullName },
  });
  if (authError || !created?.user) return { ok: false, error: `Could not create the sign-in: ${authError?.message ?? "unknown error"}` };

  const { error: profileError } = await admin.from("app_user").insert({
    id: created.user.id,
    fullName,
    email: d.email,
    roleId: role.id,
    userType: partner ? "PARTNER" : "CUSTOMER",
    partnerId: partner ? me.partnerId : null,
    contactId,
    portalScope: "ACCOUNT",
    portalRole: d.role,
    status: "ACTIVE",
    passwordHash: await bcrypt.hash(password, 10),
    updatedAt: new Date().toISOString(),
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: profileError.message };
  }
  await admin.from("audit_history").insert({
    id: crypto.randomUUID(), entityType: "User", entityId: created.user.id, fieldName: "invited",
    oldValue: null, newValue: `${d.role} by ${me.fullName}`, changedById: me.id, source: "portal", changedAt: new Date().toISOString(),
  });

  const sent = await sendPortalWelcome({
    to: d.email,
    fullName,
    password,
    contactId,
    kind: "welcome",
    audience: partner ? "partner" : "customer",
  });
  return { ok: true, data: { emailed: sent.ok } };
}
