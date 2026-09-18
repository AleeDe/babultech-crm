import { addMonths, monthStart } from "./recurring-billing";

// ------------------------------------------------------------------ renewals

export const RENEWAL_WINDOWS = [30, 60, 90] as const;
export type RenewalWindow = (typeof RENEWAL_WINDOWS)[number];

export type RenewalSource = "CONTRACT";

export type RenewalRow = {
  contractId: string;
  contractNumber: string;
  contractName: string;
  accountId: string;
  accountName: string;
  ownerUserId: string | null;
  ownerName: string | null;
  endDate: string;
  renewalType: string | null;
  noticePeriodDays: number | null;
  contractValue: number;
  currencyCode: string;
  /** Days from today to the end date. Negative once it has already lapsed. */
  daysToEnd: number;
  /** The last day the customer can still be given notice, if a notice period is set. */
  noticeBy: string | null;
  /** True once the notice deadline has passed, or is within a week. */
  noticeUrgent: boolean;
};

export function daysBetween(from: string, to: string) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The renewal view of one contract. A contract that has already ended is still
 * included with a negative day count: a lapsed renewal nobody noticed is
 * exactly the thing this queue exists to surface.
 */
export function renewalRow(
  contract: {
    id: string; contractNumber: string; name: string; accountId: string;
    endDate: string; renewalType: string | null; noticePeriodDays: number | null;
    contractValue: number; currencyCode: string;
  },
  account: { name: string; ownerUserId: string | null; ownerName: string | null },
  today: string,
): RenewalRow {
  const daysToEnd = daysBetween(today, contract.endDate);
  const noticeBy = contract.noticePeriodDays != null
    ? addDays(contract.endDate, -contract.noticePeriodDays)
    : null;
  return {
    contractId: contract.id,
    contractNumber: contract.contractNumber,
    contractName: contract.name,
    accountId: contract.accountId,
    accountName: account.name,
    ownerUserId: account.ownerUserId,
    ownerName: account.ownerName,
    endDate: contract.endDate,
    renewalType: contract.renewalType,
    noticePeriodDays: contract.noticePeriodDays,
    contractValue: contract.contractValue,
    currencyCode: contract.currencyCode,
    daysToEnd,
    noticeBy,
    noticeUrgent: noticeBy != null && daysBetween(today, noticeBy) <= 7,
  };
}

/** Contracts ending within `window` days, plus any that have already lapsed. */
export function withinWindow(rows: RenewalRow[], window: RenewalWindow) {
  return rows.filter((row) => row.daysToEnd <= window);
}

/**
 * Soonest first, and anything already lapsed ahead of everything else, because
 * a contract that ran out last week needs attention before one ending in a
 * month.
 */
export function byUrgency(rows: RenewalRow[]) {
  return [...rows].sort((a, b) => a.daysToEnd - b.daysToEnd || a.endDate.localeCompare(b.endDate));
}

export function renewalStage(row: RenewalRow): "LAPSED" | "NOTICE_DUE" | "DUE_SOON" | "UPCOMING" {
  if (row.daysToEnd < 0) return "LAPSED";
  if (row.noticeUrgent) return "NOTICE_DUE";
  if (row.daysToEnd <= 30) return "DUE_SOON";
  return "UPCOMING";
}

// -------------------------------------------------------------------- health

export type HealthSignal = { label: string; detail: string; weight: number };

export type HealthInput = {
  /** Invoices past their due date with money still outstanding. */
  overdueInvoices: { dueDate: string; outstandingAmount: number }[];
  /** Support cases still open, with what went wrong on them. */
  openCases: { slaBreached: boolean; priority: string; reopenCount: number }[];
  /** Satisfaction scores from cases closed recently, 1 to 5. */
  recentSatisfaction: number[];
  /** The last time anyone logged an activity against the account. */
  lastActivityAt: string | null;
  /** Contracts ending soon, as day counts. */
  renewalDaysToEnd: number[];
  today: string;
};

export type HealthResult = {
  status: "GREEN" | "AMBER" | "RED";
  score: number;
  signals: HealthSignal[];
};

const RED_AT = 5;
const AMBER_AT = 2;

/**
 * Health from what the records actually say, rather than from someone's
 * impression months ago.
 *
 * Deliberately a small number of plain signals: a score nobody can explain is
 * worse than no score, because people act on it anyway. Every signal that
 * counted is returned alongside the result so the page can show its reasoning.
 */
export function accountHealth(input: HealthInput): HealthResult {
  const signals: HealthSignal[] = [];

  const overdueTotal = input.overdueInvoices.reduce((sum, i) => sum + Number(i.outstandingAmount ?? 0), 0);
  if (input.overdueInvoices.length > 0 && overdueTotal > 0) {
    const oldest = input.overdueInvoices
      .map((i) => daysBetween(i.dueDate, input.today))
      .reduce((max, days) => Math.max(max, days), 0);
    // Thirty days late is a slow payer; ninety is a problem.
    const weight = oldest >= 90 ? 3 : oldest >= 30 ? 2 : 1;
    signals.push({
      label: "Overdue invoices",
      detail: `${input.overdueInvoices.length} unpaid, oldest ${oldest} days past due`,
      weight,
    });
  }

  const breached = input.openCases.filter((c) => c.slaBreached);
  if (breached.length > 0) {
    signals.push({
      label: "Missed support commitments",
      detail: `${breached.length} open case${breached.length === 1 ? "" : "s"} past the agreed response or resolution time`,
      weight: breached.length >= 2 ? 3 : 2,
    });
  }

  const urgent = input.openCases.filter((c) => !c.slaBreached && (c.priority === "HIGH" || c.priority === "CRITICAL"));
  if (urgent.length > 0) {
    signals.push({
      label: "Urgent cases open",
      detail: `${urgent.length} high or critical case${urgent.length === 1 ? "" : "s"} still open`,
      weight: 1,
    });
  }

  const reopened = input.openCases.filter((c) => (c.reopenCount ?? 0) > 0);
  if (reopened.length > 0) {
    signals.push({
      label: "Cases reopened",
      detail: `${reopened.length} case${reopened.length === 1 ? "" : "s"} came back after being closed`,
      weight: 1,
    });
  }

  if (input.recentSatisfaction.length > 0) {
    const average = input.recentSatisfaction.reduce((a, b) => a + b, 0) / input.recentSatisfaction.length;
    if (average <= 3) {
      signals.push({
        label: "Low satisfaction",
        detail: `Average ${average.toFixed(1)} out of 5 across ${input.recentSatisfaction.length} recent case${input.recentSatisfaction.length === 1 ? "" : "s"}`,
        weight: average <= 2 ? 3 : 2,
      });
    }
  }

  if (input.lastActivityAt) {
    const silent = daysBetween(input.lastActivityAt.slice(0, 10), input.today);
    if (silent >= 60) {
      signals.push({
        label: "No recent contact",
        detail: `Nothing logged for ${silent} days`,
        weight: silent >= 120 ? 2 : 1,
      });
    }
  } else {
    signals.push({ label: "No recent contact", detail: "No activity has ever been logged", weight: 1 });
  }

  const soon = input.renewalDaysToEnd.filter((days) => days <= 60);
  if (soon.length > 0) {
    const nearest = Math.min(...soon);
    signals.push({
      label: nearest < 0 ? "Contract lapsed" : "Renewal approaching",
      detail: nearest < 0
        ? `Ended ${Math.abs(nearest)} days ago`
        : `Ends in ${nearest} days`,
      weight: nearest < 0 ? 2 : 1,
    });
  }

  const score = signals.reduce((sum, s) => sum + s.weight, 0);
  const status = score >= RED_AT ? "RED" : score >= AMBER_AT ? "AMBER" : "GREEN";
  return { status, score, signals };
}

/**
 * Whether the stored health differs from what the records now say. The stored
 * value is someone's judgement and is not overwritten; this only says the two
 * disagree, so a person can look.
 */
export function healthDisagrees(stored: string | null, derived: HealthResult["status"]) {
  if (!stored) return derived !== "GREEN";
  return stored !== derived;
}

// --------------------------------------------------------------- onboarding

export const ONBOARDING_DAYS = 30;

/**
 * Customers who started recently enough that onboarding is still the job. A
 * customer marked ONBOARDING long ago is its own kind of problem, so the age
 * is reported rather than hidden.
 */
export function onboardingAge(customerStatus: string | null, since: string | null, today: string) {
  if (customerStatus !== "ONBOARDING" || !since) return null;
  const days = daysBetween(since.slice(0, 10), today);
  return { days, overdue: days > ONBOARDING_DAYS };
}

/** Accounts with no named owner at all - nobody is answerable for them. */
export function unowned<T extends { ownerUserId: string | null; ownerActive?: boolean }>(rows: T[]) {
  return rows.filter((row) => !row.ownerUserId || row.ownerActive === false);
}

export { addMonths, monthStart };
