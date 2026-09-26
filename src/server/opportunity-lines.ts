"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { one } from "@/lib/decimal";
import type { ActionResult } from "./partners";

/**
 * A deal's products and services.
 *
 * The lines are what the deal IS now: their total is the deal's amount, and the
 * service lines flagged Add in Task become the delivery project's tasks when it
 * is won. Everything here reads or writes those lines; the arithmetic itself
 * lives in the database, as generated columns, so a line's total can never
 * disagree with its own fields.
 */

export interface OpportunityLine {
  id: string;
  productId: string;
  priceBookEntryId: string | null;
  description: string | null;
  quantity: string;
  unitPrice: string;
  licenseCost: string;
  maintenanceCost: string;
  cloudCost: string;
  aiCost: string;
  discountPercent: string;
  taxRateId: string | null;
  taxPercent: string;
  netTotal: string;
  lineTotal: string;
  product: {
    id: string;
    name: string;
    productCode: string;
    productType: "PRODUCT" | "SERVICE";
    addInTask: boolean;
  } | null;
}

export interface PricingOption {
  id: string;
  name: string;
  productCode: string;
  productType: "PRODUCT" | "SERVICE";
  addInTask: boolean;
}

export interface BookEntryPrice {
  entryId: string;
  productId: string;
  quantity: string;
  rate: string;
  licenseCost: string;
  maintenanceCost: string;
  cloudCost: string;
  aiCost: string;
}

export interface OpportunityPricing {
  priceBookId: string | null;
  lines: OpportunityLine[];
  books: { id: string; name: string; validFrom: string | null; validTo: string | null }[];
  /** Prices in every active book, keyed by book, so choosing one needs no round trip. */
  pricesByBook: Record<string, BookEntryPrice[]>;
  products: PricingOption[];
  taxRates: { id: string; name: string; ratePercent: string }[];
  stage: string;
  currencyCode: string;
}

export async function getOpportunityPricing(opportunityId: string): Promise<OpportunityPricing | null> {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);
  const db = await supabaseServer();

  const { data: opp } = await db
    .from("opportunity")
    .select("id, priceBookId, stage, currencyCode")
    .eq("id", opportunityId)
    .is("deletedAt", null)
    .maybeSingle();

  if (!opp) return null;

  const [lines, books, entries, products, taxRates] = await Promise.all([
    db
      .from("opportunity_product")
      .select(
        `id, productId, priceBookEntryId, description, quantity, unitPrice,
         licenseCost, maintenanceCost, cloudCost, aiCost, discountPercent,
         taxRateId, taxPercent, netTotal, lineTotal,
         product ( id, name, productCode, productType, addInTask )`,
      )
      .eq("opportunityId", opportunityId)
      .order("sortOrder"),
    db
      .from("price_book")
      .select("id, name, validFrom, validTo")
      .eq("active", true)
      .is("deletedAt", null)
      .order("name"),
    db
      .from("price_book_entry")
      .select(
        `id, priceBookId, productId, quantity, rate,
         licenseCost, maintenanceCost, cloudCost, aiCost`,
      )
      .eq("active", true)
      .is("deletedAt", null),
    db
      .from("product")
      .select("id, name, productCode, productType, addInTask")
      .eq("active", true)
      .is("deletedAt", null)
      .order("productCode"),
    // Withholding is deducted from what WE pay, not added to what a customer
    // pays, so it does not belong on a sales line.
    db
      .from("tax_rate")
      .select("id, name, ratePercent")
      .eq("active", true)
      .eq("taxType", "SALES")
      .order("name"),
  ]);

  const pricesByBook: Record<string, BookEntryPrice[]> = {};
  for (const e of entries.data ?? []) {
    const key = e.priceBookId as string;
    (pricesByBook[key] ??= []).push({
      entryId: e.id as string,
      productId: e.productId as string,
      quantity: String(e.quantity),
      rate: String(e.rate),
      licenseCost: String(e.licenseCost),
      maintenanceCost: String(e.maintenanceCost),
      cloudCost: String(e.cloudCost),
      aiCost: String(e.aiCost),
    });
  }

  // The deal's own book stays choosable even if it has since been retired, or
  // the screen could not show what the deal was priced from.
  const bookList = (books.data ?? []) as OpportunityPricing["books"];
  if (opp.priceBookId && !bookList.some((b) => b.id === opp.priceBookId)) {
    const { data: own } = await db
      .from("price_book")
      .select("id, name, validFrom, validTo")
      .eq("id", opp.priceBookId)
      .maybeSingle();
    if (own) bookList.unshift(own as OpportunityPricing["books"][number]);
  }

  return {
    priceBookId: (opp.priceBookId as string) ?? null,
    lines: (lines.data ?? []).map((l) => ({
      ...l,
      product: one(l.product as never),
    })) as unknown as OpportunityLine[],
    books: bookList,
    pricesByBook,
    products: (products.data ?? []) as PricingOption[],
    taxRates: (taxRates.data ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      ratePercent: String(t.ratePercent),
    })),
    stage: opp.stage as string,
    currencyCode: opp.currencyCode as string,
  };
}

const amount = z.preprocess(
  (v) => (v === "" || v == null ? 0 : v),
  z.coerce.number().finite().min(0, "Amounts cannot be negative."),
);

const lineSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  productId: z.string().uuid("Choose a product or service on every line."),
  priceBookEntryId: z.string().uuid().optional().nullable(),
  description: z.string().max(4000).optional().nullable(),
  quantity: amount,
  unitPrice: amount,
  licenseCost: amount,
  maintenanceCost: amount,
  cloudCost: amount,
  aiCost: amount,
  discountPercent: z.preprocess(
    (v) => (v === "" || v == null ? 0 : v),
    z.coerce.number().min(0).max(100, "A discount cannot be more than 100%."),
  ),
  taxRateId: z.string().uuid().optional().nullable().or(z.literal("")),
});

const saveSchema = z.object({
  opportunityId: z.string().uuid(),
  priceBookId: z.string().uuid().optional().nullable().or(z.literal("")),
  lines: z.array(lineSchema),
});

export async function saveOpportunityLines(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult<{ amount: string; lines: number }>> {
  const auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please correct the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  if (d.lines.length > 0 && !d.priceBookId) {
    return { ok: false, error: "Choose the price book this deal is priced from." };
  }

  const db = await supabaseServer();
  const { data, error } = await db.rpc("save_opportunity_lines", {
    p_opportunity: d.opportunityId,
    p_price_book: d.priceBookId || null,
    p_lines: d.lines.map((l) => ({
      ...l,
      id: l.id ?? null,
      priceBookEntryId: l.priceBookEntryId ?? null,
      taxRateId: l.taxRateId || null,
    })),
  });

  if (error) return { ok: false, error: error.message };

  const result = data as { amount: number; lines: number };

  revalidatePath(`/opportunities/${d.opportunityId}`);
  revalidatePath("/opportunities");
  return { ok: true, data: { amount: String(result.amount), lines: result.lines } };
}
