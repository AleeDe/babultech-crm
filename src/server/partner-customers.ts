"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { getPortalContext } from "./portal";
import type { ActionResult } from "./partners";

/**
 * What a partner may create: customers, their people, and deals against them.
 *
 * Every write here is one `.rpc()` call to a SECURITY DEFINER function, never
 * an insert. Partners hold no INSERT policy on account, contact or opportunity,
 * so the set of things a partner can create is defined by those functions'
 * arguments rather than by the tables' columns — a much smaller thing to keep
 * correct as the schema grows.
 *
 * The functions do their own authorisation from app_current_partner_id(), which
 * is read from the session in the database. The checks in this file are there
 * to give a decent error message before a round trip, not to be the guard.
 */

/** The shape partner_find_conflict returns. */
export interface RegistrationConflict {
  conflict: boolean;
  /** True when the existing customer is one this partner already brought. */
  mine?: boolean;
  accountName?: string;
  city?: string | null;
  accountType?: string;
  customerStatus?: string | null;
  registeredOn?: string;
  /**
   * "you", the other partner's name, or null when the customer is simply ours.
   * Contact details are deliberately never returned — see the migration.
   */
  broughtBy?: string | null;
}

async function requirePartnerId(): Promise<string> {
  const ctx = await getPortalContext();
  if (!ctx?.partnerId) throw new Error("Your session has ended. Sign in again and retry.");
  return ctx.partnerId;
}

const conflictSchema = z.object({
  accountName: z.string().trim().min(1),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().optional(),
});

/**
 * Is this customer already known to us?
 *
 * Called as the partner types, before anything is written, so they find out
 * about a clash while they can still do something about it.
 */
export async function checkCustomerConflict(
  input: z.infer<typeof conflictSchema>,
): Promise<ActionResult<RegistrationConflict>> {
  try {
    await requirePartnerId();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not signed in." };
  }

  const parsed = conflictSchema.safeParse(input);
  if (!parsed.success) return { ok: true, data: { conflict: false } };

  const db = await supabaseServer();
  const { data, error } = await db.rpc("partner_find_conflict", {
    p_account_name: parsed.data.accountName,
    p_email: parsed.data.email || null,
    p_phone: parsed.data.phone || null,
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? { conflict: false }) as RegistrationConflict };
}

const customerSchema = z.object({
  accountName: z.string().trim().min(2, "Give the company a name.").max(200),
  firstName: z.string().trim().min(1, "The contact needs a first name.").max(100),
  lastName: z.string().trim().min(1, "The contact needs a last name.").max(100),
  email: z.string().trim().email("That does not look like an email address.").optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  jobTitle: z.string().trim().max(150).optional(),
  industry: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  website: z.string().trim().max(255).optional(),
  // The deal is optional: a partner often has the customer before they have a
  // number to put on it, and an invented figure makes the pipeline worse.
  dealName: z.string().trim().max(255).optional(),
  dealAmount: z.coerce.number().min(0).optional(),
  dealCloseDate: z.string().trim().optional(),
  dealCurrency: z.string().trim().length(3).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export interface CreatedCustomer {
  accountId: string;
  accountNumber: string;
  contactId: string;
  opportunityId: string | null;
  opportunityNumber: string | null;
  contested: boolean;
  conflict: RegistrationConflict;
}

/** Create the account, its primary contact, and optionally the first deal. */
export async function createPartnerCustomer(
  input: z.infer<typeof customerSchema>,
): Promise<ActionResult<CreatedCustomer>> {
  try {
    await requirePartnerId();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not signed in." };
  }

  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const db = await supabaseServer();
  const { data, error } = await db.rpc("partner_create_customer", {
    p_account_name: d.accountName,
    p_first_name: d.firstName,
    p_last_name: d.lastName,
    p_email: d.email || null,
    p_phone: d.phone || null,
    p_job_title: d.jobTitle || null,
    p_industry: d.industry || null,
    p_city: d.city || null,
    p_website: d.website || null,
    p_deal_name: d.dealName || null,
    p_deal_amount: d.dealAmount ?? null,
    p_deal_close: d.dealCloseDate || null,
    p_deal_currency: d.dealCurrency || "PKR",
    p_notes: d.notes || null,
  });

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "The customer was not created." };

  revalidatePath("/portal/accounts");
  revalidatePath("/portal/deals");
  revalidatePath("/portal");
  return { ok: true, data: data as CreatedCustomer };
}

const contactSchema = z.object({
  accountId: z.string().uuid(),
  firstName: z.string().trim().min(1, "The contact needs a first name.").max(100),
  lastName: z.string().trim().min(1, "The contact needs a last name.").max(100),
  email: z.string().trim().email("That does not look like an email address.").optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  jobTitle: z.string().trim().max(150).optional(),
});

/** Add another person at a customer this partner already brought. */
export async function addPartnerContact(
  input: z.infer<typeof contactSchema>,
): Promise<ActionResult<{ contactId: string }>> {
  try {
    await requirePartnerId();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not signed in." };
  }

  const parsed = contactSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const db = await supabaseServer();
  const { data, error } = await db.rpc("partner_add_contact", {
    p_account_id: d.accountId,
    p_first_name: d.firstName,
    p_last_name: d.lastName,
    p_email: d.email || null,
    p_phone: d.phone || null,
    p_job_title: d.jobTitle || null,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/portal/accounts");
  return { ok: true, data: data as { contactId: string } };
}

const dealSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(2, "Give the deal a name.").max(255),
  amount: z.coerce.number().min(0).optional(),
  closeDate: z.string().trim().optional(),
  currencyCode: z.string().trim().length(3).optional(),
  contactId: z.string().uuid().optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
});

/** Add a deal against a customer this partner already brought. */
export async function addPartnerOpportunity(
  input: z.infer<typeof dealSchema>,
): Promise<ActionResult<{ opportunityId: string; opportunityNumber: string }>> {
  try {
    await requirePartnerId();
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not signed in." };
  }

  const parsed = dealSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const db = await supabaseServer();
  const { data, error } = await db.rpc("partner_add_opportunity", {
    p_account_id: d.accountId,
    p_name: d.name,
    p_amount: d.amount ?? 0,
    p_close_date: d.closeDate || null,
    p_currency: d.currencyCode || "PKR",
    p_contact_id: d.contactId || null,
    p_notes: d.notes || null,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath("/portal/deals");
  revalidatePath("/portal/accounts");
  return { ok: true, data: data as { opportunityId: string; opportunityNumber: string } };
}

/**
 * The customers this partner brought, with their people and deals.
 *
 * Separate from getPortalAccounts(), which derives accounts from deal links.
 * That view answers "whose deals am I on"; this one answers "whose customers
 * are mine", and only the second may be added to.
 */
export async function listMyCustomers() {
  await requirePartnerId();
  const db = await supabaseServer();

  const { data, error } = await db
    .from("account")
    .select(
      `id, accountNumber, name, accountType, customerStatus, industry, website,
       registrationContested, createdAt,
       contacts:contact ( id, firstName, lastName, jobTitle, email, phone, isPrimary ),
       opportunities:opportunity ( id, opportunityNumber, name, stage, amount, currencyCode, expectedCloseDate )`,
    )
    .is("deletedAt", null)
    .order("createdAt", { ascending: false });

  if (error) throw new Error(`Could not load your customers: ${error.message}`);
  // No partner filter needed: account_partner_read already limits this to the
  // accounts this partner sourced. Filtering again here would hide a policy bug
  // rather than surface it.
  return data ?? [];
}
