"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "@/lib/supabase";
import { authorize, PERMISSIONS } from "@/lib/authz";
import { sendPortalWelcome } from "./portal-invite";
import type { ActionResult } from "./partners";

/**
 * Giving a customer contact a login, and taking it away.
 *
 * A customer login is the same app_user row an employee or a partner has, with
 * userType CUSTOMER and a contactId. The contact stays the CRM record of the
 * person; this only says they may sign in. Most contacts never will.
 *
 * Gated on account:write - whoever owns the customer relationship decides who
 * at that customer may raise tickets - rather than on admin:*, which would put
 * every such request through one person.
 */

const BCRYPT_ROUNDS = 12;

export interface PortalAccess {
  userId: string;
  email: string;
  status: string;
  portalScope: "OWN" | "ACCOUNT";
  lastLoginAt: string | null;
}

/** The login for one contact, if they have one. */
export async function getPortalAccess(contactId: string): Promise<PortalAccess | null> {
  const auth = await authorize(PERMISSIONS.ACCOUNT_READ);
  if (!auth.ok) return null;

  const { data } = await supabaseAdmin()
    .from("app_user")
    .select("id, email, status, portalScope, lastLoginAt")
    .eq("contactId", contactId)
    .eq("userType", "CUSTOMER")
    .is("deletedAt", null)
    .maybeSingle();

  if (!data) return null;
  return {
    userId: data.id,
    email: data.email,
    status: data.status,
    portalScope: data.portalScope,
    lastLoginAt: data.lastLoginAt,
  };
}

const grantSchema = z.object({
  contactId: z.string().uuid(),
  password: z.string().min(12, "Use at least 12 characters.").max(200),
  portalScope: z.enum(["OWN", "ACCOUNT"]).default("ACCOUNT"),
});

export async function grantPortalAccess(
  input: z.infer<typeof grantSchema>,
): Promise<ActionResult<{ email: string; emailed: boolean; emailError: string | null }>> {
  const auth = await authorize(PERMISSIONS.ACCOUNT_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the form.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const data = parsed.data;
  const admin = supabaseAdmin();

  const { data: contact } = await admin
    .from("contact")
    .select("id, firstName, lastName, email, accountId, active, deletedAt")
    .eq("id", data.contactId)
    .maybeSingle();

  if (!contact || contact.deletedAt) return { ok: false, error: "That contact no longer exists." };
  if (!contact.email) {
    return { ok: false, error: "Add an email address to the contact first - it is what they sign in with." };
  }
  if (!contact.accountId) {
    return {
      ok: false,
      error: "This contact has no company, so there is nothing to scope their access to. Set their company first.",
    };
  }

  const { data: role } = await admin
    .from("security_role")
    .select("id")
    .eq("name", "Customer")
    .maybeSingle();
  if (!role) return { ok: false, error: "The Customer role is missing. Apply the latest database migration." };

  const email = contact.email.trim().toLowerCase();

  // One login per person, whichever kind it is.
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
        clash.userType === "CUSTOMER"
          ? "This contact already has portal access."
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
    // auth.users.id === app_user.id, as everywhere else in this system.
    const { error: profileError } = await admin.from("app_user").insert({
      id: created.user.id,
      fullName: `${contact.firstName} ${contact.lastName}`.trim(),
      email,
      roleId: role.id,
      userType: "CUSTOMER",
      contactId: contact.id,
      portalScope: data.portalScope,
      status: "ACTIVE",
      passwordHash: await bcrypt.hash(data.password, BCRYPT_ROUNDS),
      updatedAt: new Date().toISOString(),
    });
    if (profileError) throw new Error(profileError.message);
  } catch (err) {
    // Otherwise the address is taken forever by an account nobody can see.
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the login." };
  }

  // Best-effort: the access is already real, so a mail failure is reported
  // rather than undoing it. Whoever granted it can then pass the password on.
  const sent = await sendPortalWelcome({
    to: email,
    fullName: `${contact.firstName} ${contact.lastName}`.trim(),
    password: data.password,
    contactId: contact.id,
    kind: "welcome",
  });

  revalidatePath(`/contacts/${contact.id}`);
  return { ok: true, data: { email, emailed: sent.ok, emailError: sent.error ?? null } };
}

const resetSchema = z.object({
  contactId: z.string().uuid(),
  password: z.string().min(12, "Use at least 12 characters.").max(200),
});

/**
 * Sets a new password for an existing customer login and emails it.
 *
 * The same path as granting, for the case this exists to serve: someone who
 * never received the first email, or who has forgotten what they were sent.
 */
export async function resetPortalPassword(
  input: z.infer<typeof resetSchema>,
): Promise<ActionResult<{ email: string; emailed: boolean; emailError: string | null }>> {
  const auth = await authorize(PERMISSIONS.ACCOUNT_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the password." };
  }

  const admin = supabaseAdmin();
  const { data: user } = await admin
    .from("app_user")
    .select("id, email, fullName")
    .eq("contactId", parsed.data.contactId)
    .eq("userType", "CUSTOMER")
    .is("deletedAt", null)
    .maybeSingle();

  if (!user) return { ok: false, error: "This contact has no portal access." };

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
    contactId: parsed.data.contactId,
    kind: "reset",
  });

  revalidatePath(`/contacts/${parsed.data.contactId}`);
  return { ok: true, data: { email: user.email, emailed: sent.ok, emailError: sent.error ?? null } };
}

/**
 * Takes the login away. The contact, their tickets and the conversation stay:
 * the customer's history is the company's record, not the login's.
 */
export async function revokePortalAccess(contactId: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ACCOUNT_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = supabaseAdmin();
  const { data: user } = await admin
    .from("app_user")
    .select("id")
    .eq("contactId", contactId)
    .eq("userType", "CUSTOMER")
    .is("deletedAt", null)
    .maybeSingle();

  if (!user) return { ok: false, error: "This contact has no portal access." };

  const now = new Date().toISOString();
  const { error } = await admin
    .from("app_user")
    .update({ status: "INACTIVE", deletedAt: now, updatedAt: now })
    .eq("id", user.id);
  if (error) return { ok: false, error: error.message };

  // Deleting the auth user is what actually ends the ability to sign in; the
  // rows above are what stops a stale session doing anything if it lingers.
  await admin.auth.admin.deleteUser(user.id).catch(() => {});

  revalidatePath(`/contacts/${contactId}`);
  return { ok: true, data: undefined };
}

/** Switches a login between their own tickets and their company's. */
export async function setPortalScope(
  contactId: string,
  portalScope: "OWN" | "ACCOUNT",
): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ACCOUNT_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const { error } = await supabaseAdmin()
    .from("app_user")
    .update({ portalScope, updatedAt: new Date().toISOString() })
    .eq("contactId", contactId)
    .eq("userType", "CUSTOMER");

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/contacts/${contactId}`);
  return { ok: true, data: undefined };
}
