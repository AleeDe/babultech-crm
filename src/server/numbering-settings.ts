"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase";
import { authorize, requireUser, can, PERMISSIONS } from "@/lib/authz";
import type { ActionResult } from "./partners";

/**
 * Record numbering: the prefix, length, year and next number of each kind of
 * record (number_sequence, used by next_sequence_number()). Administrators only.
 */

export interface NumberingRow {
  entityType: string;
  prefix: string;
  nextValue: number;
  paddingLength: number;
  includeYear: boolean;
}

export async function listNumbering(): Promise<NumberingRow[]> {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return [];
  const { data, error } = await supabaseAdmin()
    .from("number_sequence")
    .select("entityType, prefix, nextValue, paddingLength, includeYear")
    .order("entityType");
  if (error) throw new Error(`Could not load numbering: ${error.message}`);
  return (data ?? []) as NumberingRow[];
}

const schema = z.object({
  entityType: z.string().min(1).max(50),
  prefix: z.string().trim().min(1, "Give it a prefix.").max(10, "Keep the prefix to 10 characters.")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes only.").transform((s) => s.toUpperCase()),
  paddingLength: z.coerce.number().int().min(3, "At least 3 digits.").max(10, "At most 10 digits."),
  includeYear: z.boolean(),
  nextValue: z.coerce.number().int().min(1).max(2_000_000_000),
});

export async function saveNumbering(input: z.input<typeof schema>): Promise<ActionResult<NumberingRow>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the numbering." };
  const d = parsed.data;

  const db = supabaseAdmin();
  const { data: before } = await db.from("number_sequence").select("prefix, nextValue, paddingLength, includeYear").eq("entityType", d.entityType).maybeSingle();
  if (!before) return { ok: false, error: "That numbering no longer exists." };
  // Going backwards would hand out numbers that are already on records.
  if (d.nextValue < Number(before.nextValue)) {
    return { ok: false, error: `The next number can only go up - ${before.nextValue} has not been used yet, but everything below it may have been.` };
  }

  const { error } = await db
    .from("number_sequence")
    .update({ prefix: d.prefix, paddingLength: d.paddingLength, includeYear: d.includeYear, nextValue: d.nextValue, updatedAt: new Date().toISOString() })
    .eq("entityType", d.entityType);
  if (error) return { ok: false, error: error.message };

  await db.from("audit_history").insert({
    id: crypto.randomUUID(),
    entityType: "NumberSequence",
    entityId: crypto.randomUUID(),
    fieldName: d.entityType,
    oldValue: `${before.prefix}/${before.paddingLength}/${before.includeYear ? "year" : "no year"}/${before.nextValue}`,
    newValue: `${d.prefix}/${d.paddingLength}/${d.includeYear ? "year" : "no year"}/${d.nextValue}`,
    changedById: auth.user.id,
    source: "manual",
    changedAt: new Date().toISOString(),
  });

  revalidatePath("/settings/numbering");
  return { ok: true, data: { entityType: d.entityType, prefix: d.prefix, paddingLength: d.paddingLength, includeYear: d.includeYear, nextValue: d.nextValue } };
}
