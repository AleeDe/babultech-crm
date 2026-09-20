"use server";

import { commercialPlanSchema } from "@/lib/product-plans";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import Decimal from "decimal.js";
import { toDecimal, one } from "@/lib/decimal";
import { supabaseServer } from "@/lib/supabase";
import { listCatalogueProducts } from "./price-books";
import { updateRecord } from "@/lib/db";
import { SEQUENCES } from "@/lib/numbering";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import type { ActionResult } from "./partners";

/**
 * Quotations (spec §10.2).
 *
 * A quote is a document you have sent a customer, so it is treated as
 * immutable once it leaves the building: editing a SENT quote is refused and
 * `reviseQuotation` supersedes it with a new version instead. That is also
 * what makes `quotation_one_accepted_per_opportunity` — the partial unique
 * index in prisma/sql — safe to rely on.
 *
 * Totals are always recomputed here from the lines. Nothing writes a total
 * directly, so the header can never disagree with the body.
 */

const EDITABLE = ["DRAFT", "UNDER_REVIEW", "APPROVED"] as const;

const lineSchema = z.object({
  productId: z.string().uuid().optional().nullable(),
  productPlan: commercialPlanSchema.optional().nullable(),
  description: z.string().min(1, "Every line needs a description."),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
  discountPercent: z.coerce.number().min(0).max(100).optional().nullable(),
  taxRateId: z.string().uuid().optional().nullable(),
});

const quotationSchema = z.object({
  opportunityId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  quoteDate: z.coerce.date(),
  expiryDate: z.coerce.date(),
  currencyCode: z.string().length(3).default("PKR"),
  paymentTerms: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  termsAndConditions: z.string().optional().nullable(),
  lines: z.array(lineSchema).min(1, "A quote needs at least one line."),
});

interface Totals {
  subtotal: Decimal;
  discountAmount: Decimal;
  taxAmount: Decimal;
  totalAmount: Decimal;
  lines: {
    lineTotal: Decimal;
    productId: string | null;
    productPlan: z.infer<typeof commercialPlanSchema> | null;
    description: string;
    quantity: number;
    unitPrice: number;
    discountPercent: number | null;
    taxRateId: string | null;
  }[];
}

/**
 * Money maths for a document. Discount comes off the line before tax, because
 * you do not charge sales tax on a discount you did not collect.
 */
async function computeTotals(
  lines: z.infer<typeof lineSchema>[],
): Promise<Totals> {
  const taxRateIds = [...new Set(lines.map((l) => l.taxRateId).filter(Boolean))] as string[];
  const taxRates = taxRateIds.length
    ? (await (await supabaseServer()).from("tax_rate").select("id, ratePercent").in("id", taxRateIds)).data ?? []
    : [];
  const rateOf = (id: string | null | undefined) =>
    toDecimal(taxRates.find((t) => t.id === id)?.ratePercent ?? 0);

  let subtotal = toDecimal(0);
  let discountAmount = toDecimal(0);
  let taxAmount = toDecimal(0);

  const computed = lines.map((line) => {
    const gross = toDecimal(line.quantity).times(line.unitPrice);
    const discount = gross.times(line.discountPercent ?? 0).dividedBy(100);
    const net = gross.minus(discount).toDecimalPlaces(2);
    const tax = net.times(rateOf(line.taxRateId)).dividedBy(100).toDecimalPlaces(2);

    subtotal = subtotal.plus(gross);
    discountAmount = discountAmount.plus(discount);
    taxAmount = taxAmount.plus(tax);

    return {
      lineTotal: net,
      productId: line.productId ?? null,
      productPlan: line.productPlan ?? null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? null,
      taxRateId: line.taxRateId ?? null,
    };
  });

  subtotal = subtotal.toDecimalPlaces(2);
  discountAmount = discountAmount.toDecimalPlaces(2);
  taxAmount = taxAmount.toDecimalPlaces(2);

  return {
    subtotal,
    discountAmount,
    taxAmount,
    totalAmount: subtotal.minus(discountAmount).plus(taxAmount).toDecimalPlaces(2),
    lines: computed,
  };
}

export async function createQuotation(
  input: z.infer<typeof quotationSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = quotationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  if (data.expiryDate < data.quoteDate) {
    return {
      ok: false,
      error: "A quote cannot expire before it is issued.",
      fieldErrors: { expiryDate: ["Must be on or after the quote date."] },
    };
  }

  try {
    const db = await supabaseServer();

    const { data: opportunity, error: oppErr } = await db
      .from("opportunity")
      .select("accountId")
      .eq("id", data.opportunityId)
      .single();

    if (oppErr || !opportunity) return { ok: false, error: "Opportunity not found." };

    const { data: last } = await db
      .from("quotation")
      .select("versionNumber")
      .eq("opportunityId", data.opportunityId)
      .order("versionNumber", { ascending: false })
      .limit(1)
      .maybeSingle();

    const totals = await computeTotals(data.lines);

    // Quote + lines atomically: a quote with a total but no lines is not a quote.
    const { data: quote, error } = await db.rpc("create_with_lines", {
      p_table: "quotation",
      p_payload: {
        opportunityId: data.opportunityId,
        accountId: opportunity.accountId,
        contactId: data.contactId ?? null,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        status: "DRAFT",
        quoteDate: data.quoteDate.toISOString().slice(0, 10),
        expiryDate: data.expiryDate.toISOString().slice(0, 10),
        currencyCode: data.currencyCode,
        subtotal: totals.subtotal.toFixed(2),
        discountAmount: totals.discountAmount.toFixed(2),
        taxAmount: totals.taxAmount.toFixed(2),
        totalAmount: totals.totalAmount.toFixed(2),
        paymentTerms: data.paymentTerms ?? null,
        notes: data.notes ?? null,
        termsAndConditions: data.termsAndConditions ?? null,
      },
      p_line_table: "quote_line",
      p_lines: totals.lines.map((l) => ({ ...l, lineTotal: l.lineTotal.toFixed(2) })),
      p_parent_field: "quotationId",
      p_number_field: "quoteNumber",
      p_sequence: SEQUENCES.QUOTATION,
    });

    if (error) throw new Error(error.message);

    revalidatePath("/quotations");
    revalidatePath(`/opportunities/${data.opportunityId}`);
    return { ok: true, data: { id: quote.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create the quote." };
  }
}

export async function updateQuotation(
  id: string,
  input: z.infer<typeof quotationSchema>,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  const parsed = quotationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  }
  const data = parsed.data;

  try {
    const db = await supabaseServer();

    const { data: before } = await db
      .from("quotation")
      .select("status, quoteNumber")
      .eq("id", id)
      .maybeSingle();

    if (!before) return { ok: false, error: "Quote not found." };

    if (!(EDITABLE as readonly string[]).includes(before.status)) {
      return {
        ok: false,
        error: `${before.quoteNumber} is ${before.status
          .toLowerCase()
          .replace("_", " ")} and the customer has seen it. Create a revision instead of editing it.`,
      };
    }

    const totals = await computeTotals(data.lines);

    // Replaces the lines and updates the header in one transaction: a delete
    // that lands without the re-insert would leave a quote with no body.
    const { error } = await db.rpc("update_with_lines", {
      p_table: "quotation",
      p_id: id,
      p_payload: {
        contactId: data.contactId ?? null,
        quoteDate: data.quoteDate.toISOString().slice(0, 10),
        expiryDate: data.expiryDate.toISOString().slice(0, 10),
        currencyCode: data.currencyCode,
        subtotal: totals.subtotal.toFixed(2),
        discountAmount: totals.discountAmount.toFixed(2),
        taxAmount: totals.taxAmount.toFixed(2),
        totalAmount: totals.totalAmount.toFixed(2),
        paymentTerms: data.paymentTerms ?? null,
        notes: data.notes ?? null,
        termsAndConditions: data.termsAndConditions ?? null,
      },
      p_line_table: "quote_line",
      p_lines: totals.lines.map((l) => ({ ...l, lineTotal: l.lineTotal.toFixed(2) })),
      p_parent_field: "quotationId",
      p_entity_type: "Quotation",
      p_actor_id: user.id,
    });

    if (error) throw new Error(error.message);

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    return { ok: true, data: { id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not update the quote." };
  }
}

/**
 * Supersedes a sent quote with a fresh draft copy at the next version number.
 * The original is marked REVISED rather than edited, so the trail of what the
 * customer was actually shown survives.
 */
export async function reviseQuotation(id: string): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    const db = await supabaseServer();

    // Copy + supersede in one transaction — see supabase/functions-sql/023_fn_revise_quotation.sql.
    const { data: revision, error } = await db.rpc("revise_quotation", {
      p_id: id,
      p_actor_id: user.id,
    });

    if (error) return { ok: false, error: error.message };

    revalidatePath("/quotations");
    return { ok: true, data: { id: revision.id } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not revise the quote." };
  }
}

/** DRAFT/APPROVED → SENT. Also nudges the deal to Quote Submitted. */
export async function sendQuotation(id: string): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    const db = await supabaseServer();

    const { data: before } = await db
      .from("quotation")
      .select("status, quoteNumber, expiryDate, opportunityId, lines:quote_line ( id )")
      .eq("id", id)
      .maybeSingle();

    if (!before) return { ok: false, error: "Quote not found." };

    if (!(EDITABLE as readonly string[]).includes(before.status)) {
      return { ok: false, error: before.quoteNumber + " has already been sent." };
    }
    if ((before.lines ?? []).length === 0) {
      return { ok: false, error: "A quote with no lines cannot be sent." };
    }
    // PostgREST returns dates as ISO strings — parse before comparing, or this
    // check is silently always false.
    if (new Date(before.expiryDate as string) < new Date()) {
      return {
        ok: false,
        error: "This quote's expiry date has already passed. Extend it before sending.",
      };
    }

    await updateRecord(
      "quotation",
      id,
      { status: "SENT", sentAt: new Date().toISOString() },
      "Quotation",
      user.id,
    );

    const { data: opp } = await db
      .from("opportunity")
      .select("stage")
      .eq("id", before.opportunityId)
      .maybeSingle();

    const earlyStages = ["DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED"];
    if (opp && earlyStages.includes(opp.stage)) {
      await updateRecord(
        "opportunity",
        before.opportunityId,
        { stage: "QUOTE_SUBMITTED", probabilityPercent: 60 },
        "Opportunity",
        user.id,
      );
    }
    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    revalidatePath("/opportunities");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not send the quote." };
  }
}

/**
 * Customer acceptance. This is the gate `changeStage` checks before a deal can
 * be marked Closed Won, so it is deliberately a separate, audited action.
 */
export async function decideQuotation(
  id: string,
  decision: "ACCEPTED" | "REJECTED",
): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };
  const user = _auth.user;

  try {
    const db = await supabaseServer();

    const { data: before } = await db
      .from("quotation")
      .select("status, opportunityId, quoteNumber, totalAmount")
      .eq("id", id)
      .maybeSingle();

    if (!before) return { ok: false, error: "Quote not found." };

    if (before.status !== "SENT") {
      return {
        ok: false,
        error: "Only a quote that has been sent to the customer can be accepted or rejected.",
      };
    }

    if (decision === "ACCEPTED") {
      // Backstopped by quotation_one_accepted_per_opportunity (a partial unique
      // index), so a race still fails at the database rather than double-accepting.
      const { data: alreadyAccepted } = await db
        .from("quotation")
        .select("quoteNumber")
        .eq("opportunityId", before.opportunityId)
        .eq("status", "ACCEPTED")
        .is("deletedAt", null)
        .limit(1)
        .maybeSingle();

      if (alreadyAccepted) {
        return {
          ok: false,
          error: alreadyAccepted.quoteNumber + " is already the accepted quote on this deal. Only one quote per opportunity can be accepted.",
        };
      }
    }

    await updateRecord(
      "quotation",
      id,
      {
        status: decision,
        acceptedAt: decision === "ACCEPTED" ? new Date().toISOString() : null,
      },
      "Quotation",
      user.id,
    );

    // An accepted quote is the customer's commitment — reflect it on the deal.
    if (decision === "ACCEPTED") {
      await updateRecord(
        "opportunity",
        before.opportunityId,
        { stage: "VERBAL_CONFIRMATION", probabilityPercent: 90, amount: before.totalAmount },
        "Opportunity",
        user.id,
      );
    }

    revalidatePath("/quotations");
    revalidatePath(`/quotations/${id}`);
    revalidatePath("/opportunities");
    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not record the decision." };
  }
}

export async function getQuotation(id: string) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  const db = await supabaseServer();

  const { data, error } = await db
    .from("quotation")
    .select(
      `*,
       opportunity ( id, opportunityNumber, name, stage ),
       account ( id, name ),
       contact ( id, firstName, lastName, email ),
       lines:quote_line ( *, product ( id, name, productCode ), taxRate:tax_rate ( id, name, ratePercent ) )`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Could not load quote: ${error.message}`);
  if (!data) return null;

  // PostgREST cannot order an embedded relation inline, so sortOrder is applied
  // here to preserve the original `orderBy: { sortOrder: "asc" }`.
  const quoteLines = ((data.lines ?? []) as Array<Record<string, unknown>>)
    .map((l) => ({ ...l, product: one(l.product), taxRate: one(l.taxRate) }))
    .sort(
      (a, b) =>
        Number((a as { sortOrder?: number }).sortOrder ?? 0) -
        Number((b as { sortOrder?: number }).sortOrder ?? 0),
    );

  return {
    ...data,
    opportunity: one(data.opportunity),
    account: one(data.account),
    contact: one(data.contact),
    lines: quoteLines,
  };
}

export async function getQuotationFormOptions(opportunityId?: string) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);

  const db = await supabaseServer();

  const [opportunities, contacts, products, taxRates, currencies] = await Promise.all([
    db
      .from("opportunity")
      // account and lines are embedded because the form uses both: the account
      // name labels each option, and the deal's own product lines are what the
      // "pull lines from the deal" shortcut copies into the quote.
      .select(
        `id, opportunityNumber, name, accountId, currencyCode, amount,
         account ( name ),
         lines:opportunity_product (
           productId, quantity, unitPrice, discountPercent, taxRateId,
           product ( name )
         )`,
      )
      .is("deletedAt", null)
      .not("stage", "in", '("CLOSED_WON","CLOSED_LOST")')
      .order("createdAt", { ascending: false }),
    // Every live contact, narrowed to the chosen deal's account in the form.
    // Filtering here instead would mean refetching each time the opportunity
    // changes, and the list is small enough that one read covers the page.
    db
      .from("contact")
      .select("id, firstName, lastName, accountId")
      .is("deletedAt", null)
      .eq("active", true)
      .order("firstName"),
    listCatalogueProducts(),
    db.from("tax_rate").select("id, name, ratePercent").eq("active", true).order("name"),
    db.from("currency").select("code, name").eq("active", true).order("code"),
  ]);

  return {
    // PostgREST returns an embedded to-one relation as an array, so account and
    // product are flattened here rather than in the form — the shape the
    // component declares is the shape it should receive.
    opportunities: (opportunities.data ?? []).map((o) => ({
      ...o,
      account: one(o.account as { name: string } | { name: string }[] | null),
      lines: (o.lines ?? []).map((l) => ({
        ...l,
        product: one(l.product as { name: string } | { name: string }[] | null),
      })),
    })),
    contacts: contacts.data ?? [],
    products: products,
    taxRates: taxRates.data ?? [],
    currencies: currencies.data ?? [],
  };
}
