"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/supabase";
import { authorize, PERMISSIONS } from "@/lib/authz";
import type { ActionResult } from "./partners";

/**
 * Adding a value to the lists that are tables rather than picklists.
 *
 * Departments, case categories and tax rates are records with their own ids and
 * their own references, so they cannot live in picklist_value. The behaviour a
 * user sees is the same as every other dropdown: a + beside it, a name, and the
 * new value selected where they were standing.
 *
 * Each one is gated on the permission for the work it belongs to - the person
 * filing a case may name a case category - rather than on admin:*, which would
 * put a one-word addition through a second person. Renaming and removing stay
 * in Settings, with the administrator.
 */

const KINDS = {
  department: {
    table: "department",
    permission: PERMISSIONS.ADMIN,
    label: "department",
    extra: null,
  },
  caseCategory: {
    table: "case_category",
    permission: PERMISSIONS.CASE_WRITE,
    label: "case category",
    extra: null,
  },
  taxRate: {
    table: "tax_rate",
    permission: PERMISSIONS.INVOICE_WRITE,
    label: "tax rate",
    // A tax rate without a percentage is not a tax rate.
    extra: "ratePercent",
  },
} as const;

export type ReferenceKind = keyof typeof KINDS;

const schema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(100, "That name is too long."),
  channel: z.string().trim().max(50).nullable().optional(),
});

/**
 * Creates one option and returns it, shaped for the picker that asked.
 *
 * `channel` is the second field SelectWithAdd offers; for a tax rate it carries
 * the percentage, which is why it is parsed rather than stored as typed.
 */
export async function createReferenceOption(
  kind: ReferenceKind,
  input: { name: string; channel?: string | null },
): Promise<ActionResult<{ id: string; name: string }>> {
  const config = KINDS[kind];
  if (!config) return { ok: false, error: "Unknown list." };

  const auth = await authorize(config.permission);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the value." };
  }
  const name = parsed.data.name;

  const db = await supabaseServer();

  // Case-insensitive: "Support" and "support" in one dropdown is a reporting
  // problem later, not a naming preference now.
  const { data: clash } = await db.from(config.table).select("id, name").ilike("name", name).maybeSingle();
  if (clash) return { ok: true, data: { id: clash.id as string, name: clash.name as string } };

  const row: Record<string, unknown> = {
    id: randomUUID(),
    name,
    updatedAt: new Date().toISOString(),
  };

  if (config.extra === "ratePercent") {
    const percent = Number(parsed.data.channel);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { ok: false, error: "Enter the rate as a percentage, for example 18." };
    }
    row.ratePercent = percent;
    row.taxType = "SALES";
    row.active = true;
  }

  const { data, error } = await db.from(config.table).insert(row).select("id, name").single();
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true, data: { id: data.id as string, name: data.name as string } };
}

/** Bound versions, because a form action takes one argument. */
export async function createDepartment(input: { name: string; channel?: string | null }) {
  return createReferenceOption("department", input);
}
export async function createCaseCategory(input: { name: string; channel?: string | null }) {
  return createReferenceOption("caseCategory", input);
}
export async function createTaxRateOption(input: { name: string; channel?: string | null }) {
  return createReferenceOption("taxRate", input);
}
