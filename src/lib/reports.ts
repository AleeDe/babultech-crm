/**
 * The ready-made reports: what each is called, who may run it, and whether
 * it takes a date range. The figures are worked out in server/reports.ts.
 */
export const REPORTS = [
  { key: "pipeline", title: "Pipeline by stage and owner", permission: "opportunity:read", dated: false, owner: true,
    description: "Open deals: how many and how much, at each stage, for each owner." },
  { key: "won-lost", title: "Won and lost by month", permission: "opportunity:read", dated: true, owner: true,
    description: "Deals closed each month: won, lost, the value won and the win rate." },
  { key: "lead-sources", title: "Leads by source and campaign", permission: "lead:read", dated: true, owner: true,
    description: "Leads created, by where they came from, and how many were converted." },
  { key: "case-times", title: "Case response and resolution times", permission: "case:read", dated: true, owner: false,
    description: "Cases opened, by priority: average hours to first response and to resolution, and how many missed their SLA." },
  { key: "time-by-project", title: "Time logged by project", permission: "project:read", dated: true, owner: false,
    description: "Hours logged on each project, and how many of them are billable." },
] as const;

export type ReportKey = (typeof REPORTS)[number]["key"];

export interface ReportColumn {
  key: string;
  label: string;
  /** How to show it. */
  kind?: "text" | "number" | "money" | "percent" | "hours";
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
}
