import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import Decimal from "decimal.js";

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
 * Money, formatted the same on the server and in the browser.
 *
 * minimumFractionDigits is set explicitly, and that is the whole point of it.
 * PKR's standard is zero decimal places, so the two ICU builds disagreed about
 * the default: Node rendered "Rs 1,234.50" and Chromium "Rs 1,234.5". Because
 * money is formatted inside client components, React saw server text that did
 * not match the client, threw a hydration error, and threw away the
 * server-rendered table to re-render it - on five pages.
 *
 * maximumFractionDigits alone does not pin the minimum, which is why the
 * mismatch survived having one of the two set.
 */
export function formatMoney(value: Numeric, currency = "PKR"): string {
  const n = Number(toDecimal(value));
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Compact form for dashboard tiles: 1.2M, 850K. Pinned for the same reason. */
export function formatCompactMoney(value: Numeric, currency = "PKR"): string {
  const n = Number(toDecimal(value));
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    notation: "compact",
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(n);
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
