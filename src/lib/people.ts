/**
 * Hiring and employment contracts: the shapes and rules the server, the forms
 * and the tests share. No database access here.
 *
 * Internships, training and fixed-term employment run for the tenure chosen
 * at hiring; a permanent contract runs a year and is renewed at each
 * appraisal. A co-founder agreement has no end date: it records equity and
 * areas of responsibility instead, and runs until ended or revised. See
 * supabase/migrations/20261005000000_people_and_contracts.sql for the life cycle.
 */

export const CONTRACT_TYPES = ["INTERNSHIP", "TRAINING", "EMPLOYMENT", "PERMANENT", "COFOUNDER"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  INTERNSHIP: "Internship",
  TRAINING: "Training",
  EMPLOYMENT: "Employment (fixed term)",
  PERMANENT: "Permanent employment",
  COFOUNDER: "Co-founder",
};

/** A co-founder agreement: no end date, equity instead of a tenure. */
export const isCofounder = (type: string | null | undefined) => type === "COFOUNDER";

/** The tenures offered at hiring. A permanent contract is always 12 months. */
export const TENURES = [
  { months: 1, label: "1 month" },
  { months: 3, label: "3 months (quarterly)" },
  { months: 6, label: "6 months (bi-annual)" },
  { months: 12, label: "1 year" },
] as const;

export const PAY_BASES = ["NONE", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "FIXED"] as const;
export type PayBasis = (typeof PAY_BASES)[number];

export const PAY_BASIS_LABELS: Record<PayBasis, string> = {
  NONE: "No pay",
  HOURLY: "Per hour",
  DAILY: "Per day",
  WEEKLY: "Per week",
  MONTHLY: "Per month",
  FIXED: "Fixed amount for the whole term",
};

export const CONTRACT_STATUSES = [
  "DRAFT", "SENT", "EMPLOYEE_SIGNED", "SIGNED", "ACTIVE",
  "ENDED", "RENEWED", "CONVERTED", "TERMINATED", "RESIGNED", "CANCELLED",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent for signing",
  EMPLOYEE_SIGNED: "Signed by them, awaiting company",
  SIGNED: "Signed, starts on start date",
  ACTIVE: "Active",
  ENDED: "Ended",
  RENEWED: "Renewed",
  CONVERTED: "Converted",
  TERMINATED: "Terminated",
  RESIGNED: "Resigned",
  CANCELLED: "Cancelled",
};

/** Statuses in which the contract text and terms can still change. */
export const EDITABLE_STATUSES: ContractStatus[] = ["DRAFT"];
/** Before it starts, a contract can be cancelled outright. */
export const CANCELLABLE_STATUSES: ContractStatus[] = ["DRAFT", "SENT", "EMPLOYEE_SIGNED", "SIGNED"];
/** Statuses that have finished for good. */
export const CLOSED_STATUSES: ContractStatus[] = ["ENDED", "RENEWED", "CONVERTED", "TERMINATED", "RESIGNED", "CANCELLED"];

export const SIGNING_LINK_DAYS = 14;

/** The badge tone for a contract status. */
export function contractTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "SENT" || status === "EMPLOYEE_SIGNED" || status === "SIGNED") return "info";
  if (status === "DRAFT") return "warning";
  if (status === "TERMINATED" || status === "CANCELLED") return "danger";
  return "neutral";
}

/** "2026-10-05" plus whole months, the day before the same date: a term's last day. */
export function termEndDate(startDate: string, months: number): string {
  const [y, m, d] = startDate.split("-").map(Number);
  // The same day of the month, the tenure later, less a day. When that month
  // is too short for the day (31 January plus one month), the term runs to its
  // last day instead of spilling into the month after.
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  const end = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), Math.min(d, lastDay)));
  if (d <= lastDay) end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

/** The day after a date: where a renewal starts. */
export function dayAfter(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Today in Karachi, as the database's daily job counts it. */
export function karachiToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(now);
}

/** Whole days from today to a date; negative once it has passed. */
export function daysUntil(date: string | null, today = karachiToday()): number {
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function tenureLabel(months: number | null): string {
  if (months == null) return "no fixed end";
  if (months === 12) return "one year";
  if (months % 12 === 0) return `${months / 12} years`;
  return months === 1 ? "one month" : `${months} months`;
}

/** "PKR 40,000 per month", or "None" for an unpaid term. */
export function payLabel(basis: string, amount: string | number | null, currency: string | null): string {
  if (basis === "NONE" || amount == null || amount === "") return "None";
  const figure = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(amount));
  const per: Record<string, string> = {
    HOURLY: "per hour", DAILY: "per day", WEEKLY: "per week", MONTHLY: "per month", FIXED: "for the whole term",
  };
  return `${currency ?? ""} ${figure} ${per[basis] ?? ""}`.trim();
}

const figure = (v: string | number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(v));

/** "25%". */
export function percentLabel(value: string | number | null | undefined, none = "None"): string {
  return value == null || value === "" ? none : `${figure(value)}%`;
}

/** How a co-founder's equity vests, in words. */
export function vestingLabel(vestingMonths: string | number | null | undefined, cliffMonths: string | number | null | undefined): string {
  const v = vestingMonths == null || vestingMonths === "" ? null : Number(vestingMonths);
  const c = cliffMonths == null || cliffMonths === "" ? null : Number(cliffMonths);
  if (!v) return "fully vested from the start date";
  const over = v % 12 === 0 ? `${v / 12} year${v === 12 ? "" : "s"}` : `${v} months`;
  return c ? `vests in equal monthly parts over ${over}, with a ${c}-month cliff` : `vests in equal monthly parts over ${over}`;
}

/** "PKR 500,000", or "None". */
export function capitalLabel(amount: string | number | null | undefined, currency: string | null | undefined): string {
  if (amount == null || amount === "" || Number(amount) === 0) return "None";
  return `${currency ?? ""} ${figure(amount)}`.trim();
}

/**
 * A cost per hour for project costing, or null when it cannot be worked out.
 * Monthly and weekly pay need the weekly hours; a fixed amount is spread over
 * the term.
 */
export function hourlyCost(input: {
  payBasis: string;
  payAmount: number | null;
  hoursPerWeek: number | null;
  tenureMonths: number | null;
}): number | null {
  const { payBasis, payAmount, hoursPerWeek, tenureMonths } = input;
  if (payAmount == null || payAmount <= 0) return null;
  const round = (v: number) => Math.round(v * 100) / 100;
  if (payBasis === "HOURLY") return round(payAmount);
  if (payBasis === "DAILY") return round(payAmount / 8);
  if (!hoursPerWeek) return null;
  if (payBasis === "WEEKLY") return round(payAmount / hoursPerWeek);
  if (payBasis === "MONTHLY") return round((payAmount * 12) / (hoursPerWeek * 52));
  if (payBasis === "FIXED") return tenureMonths ? round(payAmount / (hoursPerWeek * (52 / 12) * tenureMonths)) : null;
  return null;
}

export const TEMPLATE_PLACEHOLDERS = [
  "companyName", "contractNumber", "today", "fullName", "fatherName", "nationalId", "address",
  "jobTitle", "department", "reportsTo", "contractType", "tenure", "startDate", "endDate",
  "hoursPerWeek", "pay", "benefits", "noticeDays", "otherTerms",
  // Co-founder agreements.
  "equity", "responsibilities", "vesting", "capital", "profitShare",
] as const;

/**
 * Fills a template's {{placeholders}}. An empty value becomes a blank line to
 * fill by hand rather than disappearing, so a missing CNIC is visible on paper.
 * Unknown placeholders are left as they are.
 */
export function fillContract(template: string, values: Partial<Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string | null>>): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key: string) => {
    if (!(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(key)) return match;
    const value = values[key as keyof typeof values];
    return value && value.trim() ? value.trim() : "____________";
  });
}

/** Benefits as the lines a contract prints. */
export function benefitLines(benefits: string[]): string {
  return benefits.length ? benefits.map((b) => `- ${b}`).join("\n") : "- None";
}

/** "5 October 2026": how dates read on a contract. */
export function contractDate(date: string | null | undefined): string {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date.slice(0, 10)}T00:00:00Z`));
}

export interface EducationEntry {
  degree: string;
  field?: string;
  institution: string;
  startYear?: string;
  endYear?: string;
  grade?: string;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  startDate?: string;
  endDate?: string;
  summary?: string;
}
