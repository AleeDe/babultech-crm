import { z } from "zod";
import { addMonths, isRecurring, type RecurringFrequency } from "./recurring-billing";
import { commercialPlanSchema } from "./product-plans";

/**
 * A customer's agreement to a product plan.
 *
 * The catalogue says what a plan costs; this says what *this customer* agreed
 * to, at what price, for how many, and when the next invoice is due. The two
 * are deliberately separate: a catalogue price change must not silently rewrite
 * what an existing customer is paying, which is why the plan is snapshotted
 * here rather than referenced.
 *
 * BILLING IS WHOLE-PERIOD, NOT PRORATED
 *
 * Quantity on the day a period starts is what that period bills. A customer who
 * adds five users mid-month is billed for them from the next period. Changes
 * are recorded with the date they took effect, so the history is there if
 * proration is ever agreed - but nothing here charges a part period. A wrong
 * proration is worse than none: it asks a customer for the wrong money.
 */

export const SUBSCRIPTION_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "CANCELLED", "ENDED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Only these bill on a calendar cycle. A one-off sale is not a subscription. */
export const SUBSCRIPTION_FREQUENCIES = ["MONTHLY", "QUARTERLY", "ANNUAL"] as const;

const MONTHS: Record<RecurringFrequency, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };

export const subscriptionSchema = z.object({
  accountId: z.string().uuid(),
  productId: z.string().uuid(),
  // The plan as agreed, not a pointer to today's catalogue.
  plan: commercialPlanSchema,
  quantity: z.coerce.number().int().min(1, "A subscription covers at least one unit.").max(100000),
  unitPrice: z.coerce.number().min(0, "Enter the agreed price."),
  currencyCode: z.string().length(3),
  billingFrequency: z.enum(SUBSCRIPTION_FREQUENCIES),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
  // Null means it runs until somebody cancels it.
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  autoRenew: z.boolean(),
  notes: z.string().trim().max(4000).nullable(),
}).refine(
  (s) => !s.endDate || s.endDate >= s.startDate,
  { message: "A subscription cannot end before it starts.", path: ["endDate"] },
);

export const quantityChangeSchema = z.object({
  subscriptionId: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(100000),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1, "Say why the quantity is changing.").max(2000),
});

export const statusChangeSchema = z.object({
  subscriptionId: z.string().uuid(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  reason: z.string().trim().min(1, "Say why.").max(2000),
});

export type Subscription = {
  id: string;
  accountId: string;
  productId: string;
  // A price book snapshot carries neither, so both are optional; rows sold
  // under the old pricing plans still have them.
  plan: { id: string; name: string; billingType?: string | null; unitOfMeasure?: string | null };
  quantity: number;
  unitPrice: number;
  currencyCode: string;
  billingFrequency: string;
  startDate: string;
  endDate: string | null;
  autoRenew: boolean;
  status: string;
  /** The first day of the next period that has not been billed. */
  nextBillingDate: string | null;
};

/** What one period costs: quantity on the day it starts, times the agreed price. */
export function periodAmount(subscription: Pick<Subscription, "quantity" | "unitPrice">) {
  return Math.round(subscription.quantity * subscription.unitPrice * 100) / 100;
}

export type BillingPeriod = { start: string; end: string };

function toUtc(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Periods that have started on or before `asOf` and begin on or after
 * `billedThrough`. A period is only billable once it has begun: invoicing a
 * month the customer has not yet had is a bill they cannot check.
 */
export function periodsDue(
  subscription: Pick<Subscription, "startDate" | "endDate" | "billingFrequency" | "status">,
  asOf: string,
  billedThrough: string | null,
  limit = 24,
): BillingPeriod[] {
  // A paused subscription stops billing; that is the difference between pausing
  // and cancelling. Draft and cancelled ones never bill.
  if (subscription.status !== "ACTIVE") return [];
  if (!isRecurring(subscription.billingFrequency)) return [];

  const step = MONTHS[subscription.billingFrequency as RecurringFrequency];
  const asOfMs = toUtc(asOf);
  const endMs = subscription.endDate ? toUtc(subscription.endDate) : null;
  const periods: BillingPeriod[] = [];

  for (let index = 0; periods.length < limit; index += 1) {
    const start = addMonths(subscription.startDate, index * step);
    const startMs = toUtc(start);
    if (startMs > asOfMs) break;
    if (endMs !== null && startMs > endMs) break;
    if (billedThrough && start <= billedThrough) continue;

    const nextStart = addMonths(subscription.startDate, (index + 1) * step);
    const naturalEnd = toUtc(nextStart) - 86_400_000;
    const end = new Date(endMs !== null ? Math.min(naturalEnd, endMs) : naturalEnd)
      .toISOString().slice(0, 10);
    periods.push({ start, end });
  }
  return periods;
}

/** The first period that has not been billed, or null if nothing is outstanding. */
export function nextBillingDate(
  subscription: Pick<Subscription, "startDate" | "endDate" | "billingFrequency" | "status">,
  billedThrough: string | null,
): string | null {
  if (subscription.status !== "ACTIVE" || !isRecurring(subscription.billingFrequency)) return null;
  const step = MONTHS[subscription.billingFrequency as RecurringFrequency];
  const endMs = subscription.endDate ? toUtc(subscription.endDate) : null;

  for (let index = 0; index < 600; index += 1) {
    const start = addMonths(subscription.startDate, index * step);
    if (endMs !== null && toUtc(start) > endMs) return null;
    if (!billedThrough || start > billedThrough) return start;
  }
  return null;
}

/**
 * The quantity in force on a given date.
 *
 * Changes are stored with the date they take effect; the one in force is the
 * latest that is not in the future. This is what makes whole-period billing
 * honest - the period bills the quantity agreed when it started, whatever
 * happened afterwards.
 */
export function quantityOn(
  base: { quantity: number; startDate: string },
  changes: readonly { quantity: number; effectiveFrom: string }[],
  date: string,
) {
  const applicable = changes
    .filter((c) => c.effectiveFrom <= date)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return applicable.length ? applicable[applicable.length - 1].quantity : base.quantity;
}

/** Which status changes are allowed, so a cancelled agreement cannot quietly restart. */
const TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "CANCELLED", "ENDED"],
  PAUSED: ["ACTIVE", "CANCELLED", "ENDED"],
  // Terminal. Reinstating means a new agreement, which keeps the old one's
  // history intact rather than rewriting it.
  CANCELLED: [],
  ENDED: [],
};

export function canTransition(from: string, to: string) {
  return (TRANSITIONS[from as SubscriptionStatus] ?? []).includes(to as SubscriptionStatus);
}

export function transitionError(from: string, to: string) {
  if (from === to) return `This subscription is already ${from.toLowerCase()}.`;
  if (from === "CANCELLED" || from === "ENDED") {
    return `A ${from.toLowerCase()} subscription cannot be changed. Create a new one instead.`;
  }
  return `A ${from.toLowerCase()} subscription cannot become ${to.toLowerCase()}.`;
}

/** Subscriptions whose end date is approaching, for the renewal queue. */
export function renewalDays(subscription: Pick<Subscription, "endDate">, today: string) {
  if (!subscription.endDate) return null;
  return Math.round((toUtc(subscription.endDate) - toUtc(today)) / 86_400_000);
}

export function describe(subscription: Pick<Subscription, "quantity" | "plan" | "unitPrice" | "currencyCode">) {
  const unit = subscription.plan.unitOfMeasure?.trim();
  const each = unit && unit.toLowerCase() !== "each" ? ` ${unit}${subscription.quantity === 1 ? "" : "s"}` : "";
  return `${subscription.quantity}${each} × ${subscription.plan.name}`;
}
