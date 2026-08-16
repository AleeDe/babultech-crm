"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { randomUUID } from "node:crypto";

/**
 * Reference data the pick lists are built from.
 *
 * These lists used to be edited only by re-seeding. Everything here is a
 * catalogue rather than anyone's pipeline, so an administrator can change it
 * from the Settings screen and every dropdown that reads it follows.
 */

export interface Currency {
  code: string;
  name: string;
  symbol: string | null;
  isBase: boolean;
  exchangeRate: string;
}

export interface TaxRate {
  id: string;
  name: string;
  ratePercent: string;
  taxType: string;
  active: boolean;
}

export interface NamedRow {
  id: string;
  name: string;
  active?: boolean;
}

async function requireAdmin() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) {
    throw new Error("Only an administrator can change reference data.");
  }
  return me;
}

export async function getSettings() {
  await requireAdmin();
  const db = await supabaseServer();

  const [currencies, taxRates, departments, caseCategories, expenseCategories] =
    await Promise.all([
      db.from("currency").select("*").order("code"),
      db.from("tax_rate").select("*").order("name"),
      db.from("department").select("id, name").order("name"),
      db.from("case_category").select("id, name, active").order("name"),
      db.from("expense_category").select("id, name").order("name"),
    ]);

  return {
    currencies: (currencies.data ?? []) as Currency[],
    taxRates: (taxRates.data ?? []) as TaxRate[],
    departments: (departments.data ?? []) as NamedRow[],
    caseCategories: (caseCategories.data ?? []) as NamedRow[],
    expenseCategories: (expenseCategories.data ?? []) as NamedRow[],
  };
}

type Result = { ok: true } | { ok: false; error: string };

const currencySchema = z.object({
  code: z.string().trim().length(3, "A currency code is exactly three letters.").toUpperCase(),
  name: z.string().trim().min(1, "Give the currency a name."),
  symbol: z.string().trim().max(8).optional().or(z.literal("")),
  exchangeRate: z.coerce.number().positive("The rate has to be above zero."),
});

export async function saveCurrency(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = currencySchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    symbol: formData.get("symbol"),
    exchangeRate: formData.get("exchangeRate"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values." };
  }

  const db = await supabaseServer();

  // currency is keyed on `code` and carries no id/updatedAt, unlike every other
  // table here.
  const { error } = await db.from("currency").upsert(
    {
      code: parsed.data.code,
      name: parsed.data.name,
      symbol: parsed.data.symbol || null,
      exchangeRate: parsed.data.exchangeRate,
      isBase: false,
    },
    { onConflict: "code" },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteCurrency(code: string): Promise<Result> {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const db = await supabaseServer();

  // The base currency is what every exchange rate is expressed against, so
  // removing it would leave the others meaningless.
  const { data: row } = await db.from("currency").select("isBase").eq("code", code).maybeSingle();
  if (row?.isBase) {
    return { ok: false, error: "That is the base currency. Make another one the base first." };
  }

  const { error } = await db.from("currency").delete().eq("code", code);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

const taxSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(1, "Give the tax rate a name."),
  ratePercent: z.coerce.number().min(0, "A rate cannot be negative."),
  taxType: z.enum(["SALES", "WITHHOLDING", "PURCHASE"]),
  active: z.coerce.boolean().optional(),
});

export async function saveTaxRate(formData: FormData): Promise<Result> {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const parsed = taxSchema.safeParse({
    id: formData.get("id") ?? "",
    name: formData.get("name"),
    ratePercent: formData.get("ratePercent"),
    taxType: formData.get("taxType"),
    active: formData.get("active") === "on",
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the values." };
  }

  const db = await supabaseServer();
  const now = new Date().toISOString();
  const { id, ...values } = parsed.data;

  const { error } = id
    ? await db.from("tax_rate").update({ ...values, updatedAt: now }).eq("id", id)
    : await db.from("tax_rate").insert({ id: randomUUID(), updatedAt: now, ...values });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

/**
 * The plain name-only lists: department, case_category, expense_category.
 *
 * Kept as one function because the three tables differ only in name, and three
 * near-identical copies would drift.
 */
const NAMED_TABLES = {
  department: "department",
  caseCategory: "case_category",
  expenseCategory: "expense_category",
} as const;

export async function saveNamedRow(
  kind: keyof typeof NAMED_TABLES,
  formData: FormData,
): Promise<Result> {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const table = NAMED_TABLES[kind];
  if (!table) return { ok: false, error: "Unknown list." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Give it a name." };

  const id = String(formData.get("id") ?? "");
  const db = await supabaseServer();
  const now = new Date().toISOString();

  const { error } = id
    ? await db.from(table).update({ name, updatedAt: now }).eq("id", id)
    : await db.from(table).insert({ id: randomUUID(), updatedAt: now, name });

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteNamedRow(
  kind: keyof typeof NAMED_TABLES,
  id: string,
): Promise<Result> {
  try {
    await requireAdmin();
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const table = NAMED_TABLES[kind];
  if (!table) return { ok: false, error: "Unknown list." };

  const db = await supabaseServer();
  const { error } = await db.from(table).delete().eq("id", id);

  if (error) {
    // A foreign key violation here means the row is in use, which is worth
    // saying plainly rather than showing the driver's message.
    return {
      ok: false,
      error: error.code === "23503"
        ? "Something still refers to this, so it cannot be removed."
        : error.message,
    };
  }

  revalidatePath("/settings");
  return { ok: true };
}
