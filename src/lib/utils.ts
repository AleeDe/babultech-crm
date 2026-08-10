import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { Prisma } from "@prisma/client";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Numeric = Prisma.Decimal | number | string | null | undefined;

/** Decimal-safe conversion. Never use Number() directly on a Prisma Decimal in money math. */
export function toDecimal(value: Numeric): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(0);
  return new Prisma.Decimal(value.toString());
}

export function formatMoney(value: Numeric, currency = "PKR"): string {
  const n = Number(toDecimal(value));
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Compact form for dashboard tiles: 1.2M, 850K. */
export function formatCompactMoney(value: Numeric, currency = "PKR"): string {
  const n = Number(toDecimal(value));
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency,
    notation: "compact",
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

/** Prisma Decimals don't survive the server→client boundary. Flatten first. */
export function serialize<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Prisma.Decimal) return v.toString();
      return v;
    }),
  );
}
