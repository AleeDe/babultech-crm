import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import Decimal from "decimal.js";
import { convert, companionCurrency } from "./currency-context";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Numeric = Decimal | number | string | null | undefined;

/** Decimal-safe conversion. Never use Number() directly on a Decimal in money math. */
export function toDecimal(value: Numeric): Decimal {
  if (value === null || value === undefined) return new Decimal(0);
  return new Decimal(value.toString());
}

/**
 * One amount in one currency: "PKR 5,000.00".
 *
 * The currency CODE rather than a symbol. With CAD, AUD and USD all written "$",
 * a symbol stops saying which dollar - and a second currency sits beside most
 * amounts now, so the two have to be told apart at a glance.
 *
 * minimumFractionDigits is pinned deliberately. PKR's standard is zero decimal
 * places, so without it the two ICU builds disagreed: Node wrote "1,234.50" and
 * Chromium "1,234.5", React saw server text that did not match the client, and
 * threw away five server-rendered pages to redraw them.
 */
export function formatMoneyPlain(value: Numeric, currency = "PKR"): string {
  const n = Number(toDecimal(value));
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Compact, single currency: "PKR 1.2M". Pinned for the same reason. */
export function formatCompactMoneyPlain(value: Numeric, currency = "PKR"): string {
  const n = Number(toDecimal(value));
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    currencyDisplay: "code",
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(n);
}

/**
 * An amount with its reference conversion: "PKR 5,000.00 (≈ USD 17.99)".
 *
 * Every calculation stays in the amount's own currency. The figure in brackets
 * is for reading only, at today's rate, and is marked ≈ so nobody takes it for
 * the recorded amount: rates move, and a March invoice converted at September's
 * rate is not what anybody was charged.
 *
 * NOT for anything a customer receives. An approximate conversion at an
 * internal rate has no place on an invoice or a quote - use formatMoneyPlain.
 */
export function formatMoney(value: Numeric, currency = "PKR"): string {
  return withCompanion(value, currency, formatMoneyPlain);
}

/** Compact, with its conversion: "PKR 1.2M (≈ USD 4.4K)". */
export function formatCompactMoney(value: Numeric, currency = "PKR"): string {
  return withCompanion(value, currency, formatCompactMoneyPlain);
}

function withCompanion(
  value: Numeric,
  currency: string,
  format: (value: Numeric, currency: string) => string,
): string {
  const primary = format(value, currency);
  const other = companionCurrency(currency);
  if (!other) return primary;
  const converted = convert(Number(toDecimal(value)), currency, other);
  if (converted === null) return primary;
  return `${primary} (≈ ${format(converted, other)})`;
}

export function formatNumber(value: Numeric, digits = 0): string {
  return new Intl.NumberFormat("en-PK", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(toDecimal(value)));
}

export function formatPercent(value: Numeric, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${Number(toDecimal(value)).toFixed(digits)}%`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

/** "CLOSED_WON" -> "Closed Won" */
export function humanize(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function daysBetween(from: Date | string, to: Date | string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * Route for a record, given the polymorphic (entityType, entityId) pair used by
 * Activity, Note, Document, Approval and Audit. Returns null when that entity
 * has no page of its own, so callers can fall back to plain text rather than
 * rendering a link that 404s.
 */
export function entityHref(
  entityType: string | null | undefined,
  entityId: string | null | undefined,
): string | null {
  if (!entityType || !entityId) return null;

  const routes: Record<string, string> = {
    Account: "/accounts",
    Contact: "/contacts",
    Lead: "/leads",
    Opportunity: "/opportunities",
    Quotation: "/quotations",
    Contract: "/contracts",
    Case: "/cases",
    SupportCase: "/cases",
    Project: "/projects",
    Invoice: "/invoices",
    Partner: "/partners",
    Campaign: "/campaigns",
    Product: "/products",
  };

  const base = routes[entityType];
  if (!base) return null;

  // Contacts and leads are edited rather than viewed — they have no read page.
  if (base === "/contacts" || base === "/leads") return `${base}/${entityId}/edit`;
  return `${base}/${entityId}`;
}

/** Decimals do not survive the server→client boundary. Flatten first. */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Decimal) return v.toString();
      return v;
    }),
  );
}
