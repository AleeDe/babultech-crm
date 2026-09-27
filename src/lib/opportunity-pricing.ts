import type { SupabaseClient } from "@supabase/supabase-js";
import { one } from "@/lib/decimal";

/**
 * A deal's products and services, and everything they could be priced from.
 *
 * Read through whichever client is passed in, so row-level security decides
 * which books, prices and items the reader is offered: our team sees the
 * whole catalogue, a partner sees BabulTech's items and their own
 * (20260928000006). Our deal page and the partner portal load pricing through
 * this one function, so the two can never describe a deal differently.
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

export async function loadOpportunityPricing(
  db: SupabaseClient,
  opportunityId: string,
  options?: {
    /**
     * Offer only these items - what the reader may sell - plus whatever is
     * already on the deal. A partner can read the items on all their deals,
     * but may put only BabulTech's and their own on this one.
     */
    sellable?: Set<string>;
  },
): Promise<OpportunityPricing | null> {
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

  const dealLines = (lines.data ?? []).map((l) => ({
    ...l,
    product: one(l.product as never),
  })) as unknown as OpportunityLine[];

  const sellable = options?.sellable;
  const onDeal = new Set(dealLines.map((l) => l.productId));
  const offered = (products.data ?? []).filter(
    (p) => !sellable || sellable.has(p.id as string) || onDeal.has(p.id as string),
  );

  return {
    priceBookId: (opp.priceBookId as string) ?? null,
    lines: dealLines,
    books: bookList,
    pricesByBook,
    products: offered.map((p) => ({
      id: p.id as string,
      name: p.name as string,
      productCode: p.productCode as string,
      productType: p.productType as PricingOption["productType"],
      addInTask: Boolean(p.addInTask),
    })),
    taxRates: (taxRates.data ?? []).map((t) => ({
      id: t.id as string,
      name: t.name as string,
      ratePercent: String(t.ratePercent),
    })),
    stage: opp.stage as string,
    currencyCode: opp.currencyCode as string,
  };
}
