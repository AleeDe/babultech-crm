"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { authorize, requirePermission, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { SEQUENCES } from "@/lib/numbering";
import { one } from "@/lib/decimal";
import {
  subscriptionSchema, quantityChangeSchema, statusChangeSchema,
  periodsDue, quantityOn, nextBillingDate, describe,
  type Subscription,
} from "@/lib/subscriptions";
import type { ActionResult } from "./partners";

const PAYMENT_TERMS_DAYS = 30;
const today = () => new Date().toISOString().slice(0, 10);

/** Subscriptions the caller can see, with their next billing date worked out. */
export async function listSubscriptions(accountId?: string) {
  await requirePermission(PERMISSIONS.ACCOUNT_READ);
  const db = await supabaseServer();

  let query = db
    .from("customer_subscription")
    .select(`*, account ( id, name ), product ( id, name ),
             changes:subscription_quantity_change ( quantity, effectiveFrom )`)
    .is("deletedAt", null)
    .order("status")
    .order("startDate", { ascending: false })
    .limit(500);

  if (accountId) query = query.eq("accountId", accountId);

  const { data, error } = await query;
  if (error) throw new Error("Could not load subscriptions.");

  const now = today();
  return (data ?? []).map((row) => {
    const changes = (Array.isArray(row.changes) ? row.changes : []) as { quantity: number; effectiveFrom: string }[];
    return {
      ...row,
      account: one(row.account as never),
      product: one(row.product as never),
      // What is being billed now, which is not always what was first agreed.
      currentQuantity: quantityOn(
        { quantity: Number(row.quantity), startDate: row.startDate as string },
        changes,
        now,
      ),
      // A change agreed for a future period would otherwise be invisible until
      // it took effect, which is exactly when somebody would want to check it.
      pendingChange: changes
        .filter((c) => c.effectiveFrom > now)
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))[0] ?? null,
      nextBillingDate: nextBillingDate(row as unknown as Subscription, row.billedThrough as string | null),
    };
  });
}

export async function getSubscription(id: string) {
  await requirePermission(PERMISSIONS.ACCOUNT_READ);
  const db = await supabaseServer();

  const { data, error } = await db
    .from("customer_subscription")
    .select(`*, account ( id, name ), product ( id, name ),
             changes:subscription_quantity_change ( *, changedBy:app_user ( fullName ) ),
             statusHistory:subscription_status_change ( *, changedBy:app_user ( fullName ) )`)
    .eq("id", id)
    .is("deletedAt", null)
    .maybeSingle();

  if (error) throw new Error("Could not load that subscription.");
  if (!data) return null;

  const changes = (Array.isArray(data.changes) ? data.changes : []) as Record<string, unknown>[];
  const invoices = await db
    .from("invoice")
    .select("id, invoiceNumber, status, totalAmount, currencyCode, periodStart, periodEnd")
    .eq("subscriptionId", id)
    .is("deletedAt", null)
    .order("periodStart", { ascending: false })
    .limit(50);

  return {
    ...data,
    account: one(data.account as never),
    product: one(data.product as never),
    changes: changes
      .map((c) => ({ ...c, changedBy: one(c.changedBy as never) }) as Record<string, unknown>)
      .sort((a, b) => String(b.effectiveFrom ?? "").localeCompare(String(a.effectiveFrom ?? ""))),
    statusHistory: ((data.statusHistory ?? []) as Record<string, unknown>[])
      .map((h) => ({ ...h, changedBy: one(h.changedBy as never) })),
    invoices: invoices.data ?? [],
    currentQuantity: quantityOn(
      { quantity: Number(data.quantity), startDate: data.startDate as string },
      changes as unknown as { quantity: number; effectiveFrom: string }[],
      today(),
    ),
    nextBillingDate: nextBillingDate(data as unknown as Subscription, data.billedThrough as string | null),
  };
}

export async function saveSubscription(
  id: string | null,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the agreement details." };
  }
  const data = parsed.data;
  const subscriptionId = id ?? randomUUID();

  const db = await supabaseServer();
  const { error } = await db.rpc("save_customer_subscription", {
    p_id: subscriptionId,
    p_account: data.accountId,
    p_product: data.productId,
    p_plan: data.plan,
    p_quantity: data.quantity,
    p_unit_price: data.unitPrice,
    p_currency: data.currencyCode,
    p_frequency: data.billingFrequency,
    p_start: data.startDate,
    p_end: data.endDate,
    p_auto_renew: data.autoRenew,
    p_notes: data.notes,
  });

  if (error) {
    return {
      ok: false,
      error: error.code === "42501"
        ? "Managing customer subscriptions needs commercial authority."
        : error.message?.includes("draft")
          ? "Only a draft subscription can be edited. Record a quantity change instead."
          : "Could not save that subscription. Check the dates, quantity and plan.",
    };
  }

  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${subscriptionId}`);
  return { ok: true, data: { id: subscriptionId } };
}

export async function changeQuantity(input: unknown): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = quantityChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the change details." };
  }

  const db = await supabaseServer();
  const { error } = await db.rpc("change_subscription_quantity", {
    p_id: randomUUID(),
    p_subscription: parsed.data.subscriptionId,
    p_quantity: parsed.data.quantity,
    p_effective: parsed.data.effectiveFrom,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return {
      ok: false,
      error: error.code === "42501"
        ? "Changing a subscription needs commercial authority."
        : error.message?.includes("already been invoiced")
          ? "That period has already been invoiced. Apply the change from a later date."
          : "Could not record that change. Check the effective date.",
    };
  }

  revalidatePath(`/subscriptions/${parsed.data.subscriptionId}`);
  return { ok: true, data: undefined };
}

export async function changeStatus(input: unknown): Promise<ActionResult> {
  const _auth = await authorize(PERMISSIONS.OPPORTUNITY_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  const parsed = statusChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details." };
  }

  const db = await supabaseServer();
  const { error } = await db.rpc("set_subscription_status", {
    p_subscription: parsed.data.subscriptionId,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return {
      ok: false,
      error: error.code === "42501"
        ? "Changing a subscription needs commercial authority."
        : error.message ?? "Could not change that subscription's status.",
    };
  }

  revalidatePath("/subscriptions");
  revalidatePath(`/subscriptions/${parsed.data.subscriptionId}`);
  return { ok: true, data: undefined };
}

/**
 * Subscription billing run. One draft invoice per period that has started and
 * has not been billed.
 *
 * Safe to re-run twice over: the run skips periods already billed, and a unique
 * index refuses a second live invoice for the same subscription period even if
 * two people start it at once.
 */
export async function runSubscriptionBilling(
  subscriptionId?: string,
): Promise<ActionResult<{ created: number; skipped: string[] }>> {
  const _auth = await authorize(PERMISSIONS.INVOICE_WRITE);
  if (!_auth.ok) return { ok: false, error: _auth.error };

  try {
    const db = await supabaseServer();
    const now = today();

    let query = db
      .from("customer_subscription")
      .select(`*, product ( name ),
               changes:subscription_quantity_change ( quantity, effectiveFrom )`)
      .eq("status", "ACTIVE")
      .is("deletedAt", null);

    if (subscriptionId) query = query.eq("id", subscriptionId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const skipped: string[] = [];
    let created = 0;

    for (const row of data ?? []) {
      const subscription = row as unknown as Subscription & { subscriptionNumber: string; billedThrough: string | null };
      const changes = (Array.isArray(row.changes) ? row.changes : []) as { quantity: number; effectiveFrom: string }[];
      const product = one(row.product as never) as { name: string } | null;
      const due = periodsDue(subscription, now, subscription.billedThrough);

      for (const period of due) {
        // Whole-period billing: the quantity in force on the day the period
        // started, not today's. A mid-period change applies from the next one.
        const quantity = quantityOn(
          { quantity: Number(subscription.quantity), startDate: subscription.startDate },
          changes,
          period.start,
        );
        const amount = Math.round(quantity * Number(subscription.unitPrice) * 100) / 100;

        if (!(amount > 0)) {
          skipped.push(`${subscription.subscriptionNumber} ${period.start} - nothing to bill`);
          continue;
        }

        const description = `${product?.name ?? "Subscription"} — ${describe({
          quantity, plan: subscription.plan, unitPrice: Number(subscription.unitPrice),
          currencyCode: subscription.currencyCode,
        })} (${period.start} to ${period.end})`;

        const { error: createError } = await db.rpc("create_with_lines", {
          p_table: "invoice",
          p_payload: {
            accountId: subscription.accountId,
            subscriptionId: subscription.id,
            invoiceDate: now,
            dueDate: new Date(Date.now() + PAYMENT_TERMS_DAYS * 86_400_000).toISOString().slice(0, 10),
            status: "DRAFT",
            currencyCode: subscription.currencyCode,
            subtotal: amount.toFixed(2),
            discountAmount: "0.00",
            taxAmount: "0.00",
            totalAmount: amount.toFixed(2),
            paidAmount: "0.00",
            outstandingAmount: amount.toFixed(2),
            paymentTermsDays: PAYMENT_TERMS_DAYS,
            periodStart: period.start,
            periodEnd: period.end,
            notes: `Subscription billing, ${subscription.subscriptionNumber}.`,
          },
          p_line_table: "invoice_line",
          p_lines: [{
            description,
            productId: subscription.productId,
            productPlan: subscription.plan,
            quantity,
            unitPrice: Number(subscription.unitPrice).toFixed(2),
            lineTotal: amount.toFixed(2),
          }],
          p_parent_field: "invoiceId",
          p_number_field: "invoiceNumber",
          p_sequence: SEQUENCES.INVOICE,
        });

        if (createError) {
          const message = createError.message ?? "";
          if (message.includes("invoice_subscription_period")) {
            skipped.push(`${subscription.subscriptionNumber} ${period.start} - already billed`);
          } else if (message.includes("month is closed")) {
            skipped.push(`${subscription.subscriptionNumber} ${period.start} - that month is closed`);
          } else {
            skipped.push(`${subscription.subscriptionNumber} ${period.start} - could not be raised`);
          }
          continue;
        }

        // Only after the invoice exists; the function refuses otherwise.
        const { error: markError } = await db.rpc("mark_subscription_billed", {
          p_subscription: subscription.id,
          p_period_start: period.start,
        });
        if (markError) {
          skipped.push(`${subscription.subscriptionNumber} ${period.start} - invoice raised but not marked billed`);
          continue;
        }
        created += 1;
      }
    }

    revalidatePath("/invoices");
    revalidatePath("/subscriptions");
    return { ok: true, data: { created, skipped } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "The subscription billing run failed." };
  }
}
