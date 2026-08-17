"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { toDecimal } from "@/lib/decimal";

/**
 * Movement, as opposed to position.
 *
 * The dashboard already answers "what are the numbers". It could not answer
 * "which way are they going", which is the question anyone actually opens a
 * dashboard with. A single figure of 4.2M in pipeline is unreadable without
 * knowing whether last week was 3.1M or 5.8M.
 *
 * Everything here is bucketed by day and returned as a plain series, so the
 * client can draw it without knowing anything about the schema. RLS applies as
 * everywhere else — a rep's trend is their own deals, not the company's.
 */

const CLOSED_STAGES = '("CLOSED_WON","CLOSED_LOST")';

export interface Series {
  /** ISO date (yyyy-mm-dd) of each bucket, oldest first. */
  days: string[];
  /** One value per day, same order. */
  values: number[];
}

export interface Pulse {
  /** Deals created per day over the window. */
  dealsCreated: Series;
  /** Value won per day over the window. */
  wonValue: Series;
  /** Cash collected per day over the window. */
  collected: Series;
  /** Cases opened per day over the window. */
  casesOpened: Series;
  /** Percentage change of the last 7 days against the 7 before them. */
  deltas: {
    dealsCreated: number | null;
    wonValue: number | null;
    collected: number | null;
    casesOpened: number | null;
  };
  windowDays: number;
}

/** Midnight-anchored ISO dates for the last `days` days, oldest first. */
function dayKeys(days: number): string[] {
  const out: string[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i += 1) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * Fold rows into one bucket per day.
 *
 * `column` null means "count the rows"; otherwise the column is summed. Rows
 * whose date falls outside the window are dropped rather than clamped to an
 * edge, which would put a spike on the first bar that never happened.
 */
function bucket(
  rows: Record<string, unknown>[],
  dateField: string,
  days: string[],
  column: string | null,
): Series {
  const index = new Map(days.map((d, i) => [d, i]));
  const values = new Array<number>(days.length).fill(0);

  for (const row of rows) {
    const raw = row[dateField];
    if (!raw) continue;
    const key = String(raw).slice(0, 10);
    const at = index.get(key);
    if (at === undefined) continue;
    values[at] += column ? Number(toDecimal(row[column])) : 1;
  }

  return { days, values };
}

/**
 * Change of the trailing week against the week before it.
 *
 * Null rather than zero when the earlier week was empty: "up 0%" and "there is
 * nothing to compare against" are different statements, and rendering the
 * second as the first invents a trend.
 */
function delta(series: Series): number | null {
  const v = series.values;
  if (v.length < 14) return null;
  const recent = v.slice(-7).reduce((a, b) => a + b, 0);
  const prior = v.slice(-14, -7).reduce((a, b) => a + b, 0);
  if (prior === 0) return recent === 0 ? null : 100;
  return ((recent - prior) / prior) * 100;
}

export async function getPulse(windowDays = 30): Promise<Pulse> {
  const me = await requireUser();
  const db = await supabaseServer();

  const days = dayKeys(windowDays);
  const from = days[0];
  // Timestamp columns need the full instant, date columns only the date part.
  const fromInstant = `${from}T00:00:00.000Z`;

  const seeSales = can(me, PERMISSIONS.OPPORTUNITY_READ);
  const seeFinance = can(me, PERMISSIONS.INVOICE_READ);
  const seeCases = can(me, PERMISSIONS.CASE_READ);

  const empty = { data: [] as Record<string, unknown>[] };

  const [created, won, collected, cases] = await Promise.all([
    seeSales
      ? db.from("opportunity").select("createdAt")
          .is("deletedAt", null).gte("createdAt", fromInstant)
      : empty,
    seeSales
      ? db.from("opportunity").select("actualCloseDate, amount")
          .is("deletedAt", null).eq("stage", "CLOSED_WON").gte("actualCloseDate", from)
      : empty,
    seeFinance
      ? db.from("payment").select("paymentDate, amount")
          .is("deletedAt", null).eq("status", "CLEARED").gte("paymentDate", from)
      : empty,
    seeCases
      ? db.from("support_case").select("createdAt")
          .is("deletedAt", null).gte("createdAt", fromInstant)
      : empty,
  ]);

  const dealsCreated = bucket((created.data ?? []) as Record<string, unknown>[], "createdAt", days, null);
  const wonValue = bucket((won.data ?? []) as Record<string, unknown>[], "actualCloseDate", days, "amount");
  const collectedSeries = bucket((collected.data ?? []) as Record<string, unknown>[], "paymentDate", days, "amount");
  const casesOpened = bucket((cases.data ?? []) as Record<string, unknown>[], "createdAt", days, null);

  return {
    dealsCreated,
    wonValue,
    collected: collectedSeries,
    casesOpened,
    deltas: {
      dealsCreated: delta(dealsCreated),
      wonValue: delta(wonValue),
      collected: delta(collectedSeries),
      casesOpened: delta(casesOpened),
    },
    windowDays,
  };
}

export interface FeedItem {
  id: string;
  at: string;
  entityType: string;
  entityId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string | null;
}

/**
 * The most recent changes anyone made, as a flat stream.
 *
 * Reads `audit_history` rather than polling each table: it is already the one
 * place every write lands, it carries who and what changed, and RLS on it
 * matches the records it describes.
 */
export async function getRecentChanges(limit = 25): Promise<FeedItem[]> {
  await requireUser();
  const db = await supabaseServer();

  const { data } = await db
    .from("audit_history")
    .select("id, changedAt, entityType, entityId, fieldName, oldValue, newValue, changedBy:app_user ( fullName )")
    .order("changedAt", { ascending: false })
    .limit(limit);

  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: String(r.id),
    at: String(r.changedAt),
    entityType: String(r.entityType),
    entityId: String(r.entityId),
    fieldName: String(r.fieldName),
    oldValue: r.oldValue ?? null,
    newValue: r.newValue ?? null,
    // PostgREST returns an embedded to-one as an object or a one-element array
    // depending on how it inferred the relationship.
    actor:
      (Array.isArray(r.changedBy) ? r.changedBy[0]?.fullName : r.changedBy?.fullName) ?? null,
  }));
}
