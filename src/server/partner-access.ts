"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { authorize, PERMISSIONS } from "@/lib/authz";
import { sendPortalWelcome } from "./portal-invite";
import type { ActionResult } from "./partners";

/**
 * Logins for a partner's own people.
 *
 * The same shape as customer access: a login is a person acting for an
 * organisation. Here the organisation is the partner, and the people are the
 * contacts linked to it through partner_contact.
 *
 * Partner logins could always be made from the Users screen by ticking a box.
 * That still works and older logins carry no contact, but it is the wrong
 * place: an external login is not a member of staff, and whoever manages the
 * partnership is the one who should decide who at that partner may sign in.
 */

const BCRYPT_ROUNDS = 12;

export interface PartnerLoginPerson {
  contactId: string | null;
  name: string;
  email: string | null;
  role: string | null;
  /** Their login, if they have one. */
  login: { userId: string; email: string; status: string; lastLoginAt: string | null } | null;
}

/**
 * The partner's people and who among them can sign in, plus any login that
 * predates contacts being recorded, so nothing is invisible on this screen.
 */
export async function listPartnerPortalAccess(partnerId: string): Promise<PartnerLoginPerson[]> {
  const auth = await authorize(PERMISSIONS.PARTNER_READ);
  if (!auth.ok) return [];

  const admin = supabaseAdmin();
  const [contacts, logins] = await Promise.all([
    admin
      .from("partner_contact")
      .select("role, isPrimary, contact:contact ( id, firstName, lastName, email, deletedAt )")
      .eq("partnerId", partnerId)
      .order("isPrimary", { ascending: false }),
    admin
      .from("app_user")
      .select("id, email, status, lastLoginAt, contactId")
      .eq("partnerId", partnerId)
      .eq("userType", "PARTNER")
      .is("deletedAt", null),
  ]);

  const byContact = new Map<string, { userId: string; email: string; status: string; lastLoginAt: string | null }>();
  const unlinked: PartnerLoginPerson[] = [];

  for (const row of logins.data ?? []) {
    const login = { userId: row.id as string, email: row.email as string, status: row.status as string, lastLoginAt: (row.lastLoginAt as string | null) ?? null };
    if (row.contactId) byContact.set(row.contactId as string, login);
    else unlinked.push({ contactId: null, name: row.email as string, email: row.email as string, role: "Login with no contact recorded", login });
  }

  const people = (contacts.data ?? [])
    .map((row) => {
      const contact = (Array.isArray(row.contact) ? row.contact[0] : row.contact) as
        { id: string; firstName: string; lastName: string; email: string | null; deletedAt: string | null } | null;
      if (!contact || contact.deletedAt) return null;
      return {
        contactId: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        email: contact.email,
        role: (row.role as string | null) ?? null,
        login: byContact.get(contact.id) ?? null,
      };
    })
    .filter((p) => p !== null) as PartnerLoginPerson[];

  return [...people, ...unlinked];
}

const grantSchema = z.object({
  partnerId: z.string().uuid(),
  contactId: z.string().uuid(),
  password: z.string().min(12, "Use at least 12 characters.").max(200),
});

export async function grantPartnerAccess(
  input: z.infer<typeof grantSchema>,
): Promise<ActionResult<{ email: string; emailed: boolean; emailError: string | null }>> {
  const auth = await authorize(PERMISSIONS.PARTNER_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }
  const data = parsed.data;
  const admin = supabaseAdmin();

  // The contact has to belong to this partner. Taken from the join table rather
  // than trusted from the form, so a contact id from elsewhere finds nothing.
  const { data: link } = await admin
    .from("partner_contact")
    .select("contact:contact ( id, firstName, lastName, email, deletedAt )")
    .eq("partnerId", data.partnerId)
    .eq("contactId", data.contactId)
    .maybeSingle();

  const contact = (Array.isArray(link?.contact) ? link?.contact[0] : link?.contact) as
    { id: string; firstName: string; lastName: string; email: string | null; deletedAt: string | null } | null;

  if (!contact || contact.deletedAt) {
    return { ok: false, error: "That person is not a contact of this partner." };
  }
  if (!contact.email) {
    return { ok: false, error: "Add an email address to the contact first - it is what they sign in with." };
  }

  const { data: partner } = await admin
    .from("partner")
    .select("id, displayName, status, deletedAt")
    .eq("id", data.partnerId)
    .maybeSingle();
  if (!partner || partner.deletedAt) return { ok: false, error: "That partner no longer exists." };

  const { data: role } = await admin.from("security_role").select("id").eq("name", "Partner").maybeSingle();
  if (!role) return { ok: false, error: "The Partner role is missing. Create it in Settings first." };

  const email = contact.email.trim().toLowerCase();
  const { data: clash } = await admin
    .from("app_user")
    .select("id, userType")
    .ilike("email", email)
    .is("deletedAt", null)
    .maybeSingle();
  if (clash) {
    return {
      ok: false,
      error:
        clash.userType === "PARTNER"
          ? "This person already has a partner login."
          : "That email already has a login of another kind. A person needs a separate address for each.",
    };
  }

  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password: data.password,
    email_confirm: true,
    user_metadata: { fullName: `${contact.firstName} ${contact.lastName}`.trim() },
  });
  if (authError || !created?.user) {
    return { ok: false, error: `Could not create the sign-in account: ${authError?.message ?? "unknown error"}` };
  }

  try {
    const { error: profileError } = await admin.from("app_user").insert({
      id: created.user.id,
      fullName: `${contact.firstName} ${contact.lastName}`.trim(),
      email,
      roleId: role.id,
      userType: "PARTNER",
      partnerId: data.partnerId,
      contactId: contact.id,
      status: "ACTIVE",
      passwordHash: await bcrypt.hash(data.password, BCRYPT_ROUNDS),
      updatedAt: new Date().toISOString(),
    });
    if (profileError) throw new Error(profileError.message);
  } catch (err) {
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the login." };
  }

  const sent = await sendPortalWelcome({
    to: email,
    fullName: `${contact.firstName} ${contact.lastName}`.trim(),
    password: data.password,
    contactId: contact.id,
    kind: "welcome",
    audience: "partner",
  });

  revalidatePath(`/partners/${data.partnerId}`);
  return { ok: true, data: { email, emailed: sent.ok, emailError: sent.error ?? null } };
}

const resetSchema = z.object({
  partnerId: z.string().uuid(),
  userId: z.string().uuid(),
  password: z.string().min(12, "Use at least 12 characters.").max(200),
});

export async function resetPartnerPassword(
  input: z.infer<typeof resetSchema>,
): Promise<ActionResult<{ email: string; emailed: boolean; emailError: string | null }>> {
  const auth = await authorize(PERMISSIONS.PARTNER_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the password." };
  }

  const admin = supabaseAdmin();
  const { data: user } = await admin
    .from("app_user")
    .select("id, email, fullName, contactId")
    .eq("id", parsed.data.userId)
    .eq("partnerId", parsed.data.partnerId)
    .eq("userType", "PARTNER")
    .is("deletedAt", null)
    .maybeSingle();
  if (!user) return { ok: false, error: "That login does not belong to this partner." };

  const { error: authError } = await admin.auth.admin.updateUserById(user.id, {
    password: parsed.data.password,
  });
  if (authError) return { ok: false, error: `Could not set the password: ${authError.message}` };

  await admin
    .from("app_user")
    .update({
      passwordHash: await bcrypt.hash(parsed.data.password, BCRYPT_ROUNDS),
      updatedAt: new Date().toISOString(),
    })
    .eq("id", user.id);

  const sent = await sendPortalWelcome({
    to: user.email,
    fullName: user.fullName,
    password: parsed.data.password,
    contactId: (user.contactId as string | null) ?? parsed.data.partnerId,
    kind: "reset",
    audience: "partner",
  });

  revalidatePath(`/partners/${parsed.data.partnerId}`);
  return { ok: true, data: { email: user.email, emailed: sent.ok, emailError: sent.error ?? null } };
}

/** Ends the login. The partner, their deals and their commission stay. */
export async function revokePartnerAccess(partnerId: string, userId: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.PARTNER_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = supabaseAdmin();
  const { data: user } = await admin
    .from("app_user")
    .select("id")
    .eq("id", userId)
    .eq("partnerId", partnerId)
    .eq("userType", "PARTNER")
    .is("deletedAt", null)
    .maybeSingle();
  if (!user) return { ok: false, error: "That login does not belong to this partner." };

  const now = new Date().toISOString();
  const { error } = await admin
    .from("app_user")
    .update({ status: "INACTIVE", deletedAt: now, updatedAt: now })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  await admin.auth.admin.deleteUser(userId).catch(() => {});

  revalidatePath(`/partners/${partnerId}`);
  return { ok: true, data: undefined };
}
