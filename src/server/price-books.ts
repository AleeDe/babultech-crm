"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import type { ActionResult } from "./partners";

/**
 * Price books: a product's priced offers.
 *
 * One product can carry several at once (Standard, Premium) and over time
 * (2025 rates, 2026 rates). A deal copies the book's four costs when it picks
 * one, so changing or retiring a book never rewrites deals already priced from
 * it - the old customers keep the old price.
 */

export interface PriceBook {
  id: string;
  productId: string;
  name: string;
  description: string | null;
  currencyCode: string;
  licenseCost: string;
  maintenanceCost: string;
  cloudCost: string;
  aiCost: string;
  validFrom: string | null;
  validTo: string | null;
  active: boolean;
}

const money = z.preprocess(
  (v) => (v === "" || v == null ? 0 : v),
  z.coerce.number().finite().min(0, "Costs cannot be negative."),
);
const optionalDate = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().date().nullable());

const priceBookSchema = z
  .object({
    id: z.string().uuid().optional().nullable(),
    productId: z.string().uuid(),
    name: z.string().trim().min(1, "Give the price book a name.").max(100, "That name is too long."),
    description: z.string().trim().max(2000).optional().nullable(),
    currencyCode: z.string().length(3).default("PKR"),
    licenseCost: money,
    maintenanceCost: money,
    cloudCost: money,
    aiCost: money,
    validFrom: optionalDate,
    validTo: optionalDate,
    active: z.boolean().default(true),
  })
  .refine((v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom, {
    path: ["validTo"],
    message: "Must be on or after the start date.",
  });

export async function listPriceBooks(productId: string): Promise<PriceBook[]> {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);
  const db = await supabaseServer();
  const { data, error } = await db
    .from("price_book")
    .select("*")
    .eq("productId", productId)
    .is("deletedAt", null)
    .order("active", { ascending: false })
    .order("name");
  // Before the migration is applied the table does not exist; show no books
  // rather than breaking the product page.
  if (error) return [];
  return (data ?? []) as PriceBook[];
}

export async function savePriceBook(
  input: z.input<typeof priceBookSchema>,
): Promise<ActionResult<{ id: string }>> {
  const auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = priceBookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const { id, ...values } = parsed.data;
  const db = await supabaseServer();
  const row = { ...values, description: values.description || null, updatedAt: new Date().toISOString() };

  const { data, error } = id
    ? await db.from("price_book").update(row).eq("id", id).is("deletedAt", null).select("id").maybeSingle()
    : await db.from("price_book").insert(row).select("id").single();

  if (error) {
    return {
      ok: false,
      error: error.code === "23505" ? "This product already has a price book with that name." : error.message,
    };
  }
  if (!data) return { ok: false, error: "That price book no longer exists." };

  revalidatePath(`/products/${values.productId}`);
  return { ok: true, data: { id: data.id } };
}

/**
 * Removes a price book from the product.
 *
 * Deals that used it keep their copied costs and their link, so this is a soft
 * delete. To stop offering a book while keeping it visible, mark it inactive.
 */
export async function deletePriceBook(id: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("price_book")
    .update({ deletedAt: now, active: false, updatedAt: now })
    .eq("id", id)
    .is("deletedAt", null)
    .select("productId")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "That price book no longer exists." };

  revalidatePath(`/products/${data.productId}`);
  return { ok: true, data: undefined };
}

/**
 * The sellable catalogue: active products, each with its active price books.
 *
 * Quote, invoice and deal lines price from these. A product with no price book
 * can still be put on a line; its price is then typed in.
 */
export async function listCatalogueProducts(): Promise<
  {
    id: string;
    name: string;
    productCode: string;
    defaultTaxRateId: string | null;
    priceBooks: { id: string; name: string; total: string }[];
  }[]
> {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);
  const db = await supabaseServer();

  const [products, books] = await Promise.all([
    db
      .from("product")
      .select("id, name, productCode, defaultTaxRateId")
      .is("deletedAt", null)
      .eq("active", true)
      .order("name"),
    db
      .from("price_book")
      .select("id, productId, name, licenseCost, maintenanceCost, cloudCost, aiCost")
      .is("deletedAt", null)
      .eq("active", true)
      .order("name"),
  ]);

  const byProduct = new Map<string, { id: string; name: string; total: string }[]>();
  for (const b of books.data ?? []) {
    const total =
      Number(b.licenseCost) + Number(b.maintenanceCost) + Number(b.cloudCost) + Number(b.aiCost);
    const list = byProduct.get(b.productId as string) ?? [];
    list.push({ id: b.id as string, name: b.name as string, total: total.toFixed(2) });
    byProduct.set(b.productId as string, list);
  }

  return (products.data ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    productCode: p.productCode as string,
    defaultTaxRateId: (p.defaultTaxRateId as string | null) ?? null,
    priceBooks: byProduct.get(p.id as string) ?? [],
  }));
}
