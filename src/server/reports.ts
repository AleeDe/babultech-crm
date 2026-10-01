"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { authorize, requireUser, requirePermission, scopeFilter } from "@/lib/authz";
import { applyScope } from "@/lib/db";
import { REPORTS, type ReportKey, type ReportResult } from "@/lib/reports";
import { listLeads } from "./crm";
import { listOpportunities } from "./opportunities";
import type { ActionResult } from "./partners";

/**
 * Ready-made reports. Each reads through the person's own session and the
 * same scope as its list screen, so two people can correctly get different
 * figures for the same report.
 */

export interface ReportFilters {
  from?: string;
  to?: string;
  ownerId?: string;
}

const STAGES = ["DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED", "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION", "ON_HOLD"];
const words = (v: string | null | undefined) => (v ? v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");
const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : null);
const inRange = (iso: string | null | undefined, f: ReportFilters) => {
  const d = day(iso);
  if (!d) return false;
  if (f.from && d < f.from) return false;
  if (f.to && d > f.to) return false;
  return true;
};
const hoursBetween = (a: string, b: string) => {
  const ms = (s: string) => new Date(/[zZ]$/.test(s) ? s : `${s}Z`).getTime();
  return (ms(b) - ms(a)) / 3_600_000;
};
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

export async function runReport(key: ReportKey, f: ReportFilters): Promise<ReportResult> {
  const report = REPORTS.find((r) => r.key === key);
  if (!report) throw new Error("No such report.");
  await requirePermission(report.permission);

  if (key === "pipeline") {
    const deals = (await listOpportunities({ ownerUserId: f.ownerId || undefined })) as Record<string, any>[];
    const open = deals.filter((d) => STAGES.includes(d.stage));
    const owners = [...new Set(open.map((d) => d.owner?.fullName ?? "Nobody"))].sort();
    const rows = STAGES.flatMap((stage) =>
      owners
        .map((owner) => {
          const here = open.filter((d) => d.stage === stage && (d.owner?.fullName ?? "Nobody") === owner);
          return here.length
            ? { stage: words(stage), owner, deals: here.length, value: here.reduce((s, d) => s + Number(d.amount ?? 0), 0) }
            : null;
        })
        .filter((r): r is NonNullable<typeof r> => r !== null),
    );
    return {
      columns: [
        { key: "stage", label: "Stage" }, { key: "owner", label: "Owner" },
        { key: "deals", label: "Deals", kind: "number" }, { key: "value", label: "Value", kind: "money" },
      ],
      rows,
      totals: { stage: "Total", owner: null, deals: open.length, value: open.reduce((s, d) => s + Number(d.amount ?? 0), 0) },
    };
  }

  if (key === "won-lost") {
    const deals = (await listOpportunities({ ownerUserId: f.ownerId || undefined })) as Record<string, any>[];
    const closed = deals.filter((d) => ["CLOSED_WON", "CLOSED_LOST"].includes(d.stage) && inRange(d.actualCloseDate ?? d.updatedAt, f));
    const months = [...new Set(closed.map((d) => String(d.actualCloseDate ?? d.updatedAt).slice(0, 7)))].sort().reverse();
    const rows = months.map((m) => {
      const here = closed.filter((d) => String(d.actualCloseDate ?? d.updatedAt).startsWith(m));
      const won = here.filter((d) => d.stage === "CLOSED_WON");
      return {
        month: m, won: won.length, lost: here.length - won.length,
        value: won.reduce((s, d) => s + Number(d.amount ?? 0), 0),
        winRate: here.length ? Math.round((won.length / here.length) * 100) : null,
      };
    });
    const won = closed.filter((d) => d.stage === "CLOSED_WON");
    return {
      columns: [
        { key: "month", label: "Month" }, { key: "won", label: "Won", kind: "number" }, { key: "lost", label: "Lost", kind: "number" },
        { key: "value", label: "Value won", kind: "money" }, { key: "winRate", label: "Win rate", kind: "percent" },
      ],
      rows,
      totals: {
        month: "Total", won: won.length, lost: closed.length - won.length,
        value: won.reduce((s, d) => s + Number(d.amount ?? 0), 0),
        winRate: closed.length ? Math.round((won.length / closed.length) * 100) : null,
      },
    };
  }

  if (key === "lead-sources") {
    const [open, prospects] = await Promise.all([listLeads({}), listLeads({ status: "PROSPECT" })]);
    const leads = [...open, ...prospects].filter(
      (l) => inRange(l.createdAt as string, f) && (!f.ownerId || l.ownerUserId === f.ownerId),
    ) as Record<string, any>[];
    const groups = new Map<string, Record<string, any>[]>();
    for (const l of leads) {
      const k = `${l.leadSource ?? "Not recorded"}|${l.campaign?.name ?? "—"}`;
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    const rows = [...groups.entries()]
      .map(([k, ls]) => {
        const [source, campaign] = k.split("|");
        const converted = ls.filter((l) => l.status === "CONVERTED").length;
        return { source, campaign, leads: ls.length, converted, rate: Math.round((converted / ls.length) * 100) };
      })
      .sort((a, b) => b.leads - a.leads);
    const converted = leads.filter((l) => l.status === "CONVERTED").length;
    return {
      columns: [
        { key: "source", label: "Source" }, { key: "campaign", label: "Campaign" }, { key: "leads", label: "Leads", kind: "number" },
        { key: "converted", label: "Converted", kind: "number" }, { key: "rate", label: "Conversion", kind: "percent" },
      ],
      rows,
      totals: { source: "Total", campaign: null, leads: leads.length, converted, rate: leads.length ? Math.round((converted / leads.length) * 100) : null },
    };
  }

  if (key === "case-times") {
    const me = await requireUser();
    const db = await supabaseServer();
    let query = db
      .from("support_case")
      .select("priority, createdAt, firstRespondedAt, resolvedAt, slaBreached")
      .is("deletedAt", null)
      .limit(5000);
    if (f.from) query = query.gte("createdAt", f.from);
    if (f.to) query = query.lte("createdAt", `${f.to}T23:59:59`);
    query = applyScope(query, await scopeFilter(me, "ownerUserId"));
    const { data } = await query;
    const cases = (data ?? []) as Record<string, any>[];
    const rows = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => {
      const here = cases.filter((c) => c.priority === p);
      return {
        priority: words(p),
        cases: here.length,
        firstResponse: avg(here.filter((c) => c.firstRespondedAt).map((c) => hoursBetween(c.createdAt, c.firstRespondedAt))),
        resolution: avg(here.filter((c) => c.resolvedAt).map((c) => hoursBetween(c.createdAt, c.resolvedAt))),
        breached: here.filter((c) => c.slaBreached).length,
      };
    });
    return {
      columns: [
        { key: "priority", label: "Priority" }, { key: "cases", label: "Cases", kind: "number" },
        { key: "firstResponse", label: "Avg first response", kind: "hours" }, { key: "resolution", label: "Avg resolution", kind: "hours" },
        { key: "breached", label: "SLA missed", kind: "number" },
      ],
      rows,
      totals: {
        priority: "All", cases: cases.length,
        firstResponse: avg(cases.filter((c) => c.firstRespondedAt).map((c) => hoursBetween(c.createdAt, c.firstRespondedAt))),
        resolution: avg(cases.filter((c) => c.resolvedAt).map((c) => hoursBetween(c.createdAt, c.resolvedAt))),
        breached: cases.filter((c) => c.slaBreached).length,
      },
    };
  }

  // time-by-project: row security decides whose time each person may see.
  const db = await supabaseServer();
  let query = db.from("time_log").select("hours, billable, workDate, project ( id, name, projectNumber )").limit(20000);
  if (f.from) query = query.gte("workDate", f.from);
  if (f.to) query = query.lte("workDate", f.to);
  const { data } = await query;
  const logs = (data ?? []) as Record<string, any>[];
  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  const byProject = new Map<string, { project: string; hours: number; billable: number }>();
  for (const l of logs) {
    const p = one<{ id: string; name: string; projectNumber: string }>(l.project);
    const k = p?.id ?? "none";
    const row = byProject.get(k) ?? { project: p ? `${p.projectNumber} ${p.name}` : "No project", hours: 0, billable: 0 };
    row.hours += Number(l.hours ?? 0);
    if (l.billable) row.billable += Number(l.billable ? l.hours ?? 0 : 0);
    byProject.set(k, row);
  }
  const rows = [...byProject.values()]
    .map((r) => ({ ...r, hours: Math.round(r.hours * 10) / 10, billable: Math.round(r.billable * 10) / 10, share: r.hours ? Math.round((r.billable / r.hours) * 100) : null }))
    .sort((a, b) => b.hours - a.hours);
  const hours = rows.reduce((s, r) => s + r.hours, 0);
  const billable = rows.reduce((s, r) => s + r.billable, 0);
  return {
    columns: [
      { key: "project", label: "Project" }, { key: "hours", label: "Hours", kind: "number" },
      { key: "billable", label: "Billable hours", kind: "number" }, { key: "share", label: "Billable share", kind: "percent" },
    ],
    rows,
    totals: { project: "Total", hours: Math.round(hours * 10) / 10, billable: Math.round(billable * 10) / 10, share: hours ? Math.round((billable / hours) * 100) : null },
  };
}

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------

export interface ReportSchedule {
  id: string;
  reportKey: string;
  title: string;
  link: string;
  frequency: string;
  nextRunAt: string;
}

export async function listMySchedules(reportKey?: string): Promise<ReportSchedule[]> {
  const me = await requireUser();
  const db = await supabaseServer();
  let query = db.from("report_schedule").select("id, reportKey, title, link, frequency, nextRunAt").eq("userId", me.id).order("createdAt");
  if (reportKey) query = query.eq("reportKey", reportKey);
  const { data } = await query;
  return (data ?? []) as ReportSchedule[];
}

const scheduleSchema = z.object({
  reportKey: z.enum(REPORTS.map((r) => r.key) as [string, ...string[]]),
  query: z.string().max(800),
  frequency: z.enum(["WEEKLY", "MONTHLY"]),
});

/** Asks for this report, with these filters, weekly or monthly. */
export async function scheduleReport(input: z.infer<typeof scheduleSchema>): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That schedule could not be saved." };
  const report = REPORTS.find((r) => r.key === parsed.data.reportKey)!;
  const params = new URLSearchParams(parsed.data.query);
  // Fixed dates would freeze the report; a schedule always shows the latest.
  params.delete("from");
  params.delete("to");
  const qs = params.toString();
  const next = new Date();
  next.setUTCDate(next.getUTCDate() + (parsed.data.frequency === "WEEKLY" ? 7 : 30));
  next.setUTCHours(2, 0, 0, 0);
  const db = await supabaseServer();
  const { error } = await db.from("report_schedule").insert({
    userId: auth.user.id,
    reportKey: report.key,
    title: report.title,
    link: `/reports/${report.key}${qs ? `?${qs}` : ""}`,
    frequency: parsed.data.frequency,
    nextRunAt: next.toISOString(),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/reports/${report.key}`);
  return { ok: true, data: undefined };
}

export async function deleteSchedule(id: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  const db = await supabaseServer();
  const { error } = await db.from("report_schedule").delete().eq("id", id).eq("userId", auth.user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/reports");
  return { ok: true, data: undefined };
}
