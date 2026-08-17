/**
 * Spread the demo records across the trend window.
 *
 * The seed writes everything in one run, so every row carries the same
 * createdAt and the dashboard's 30-day sparklines are a single spike against a
 * flat line — technically accurate and useless as a demonstration.
 *
 * This backdates existing rows only. It creates nothing, deletes nothing, and
 * touches no amount, status or relationship, so every total on every screen is
 * exactly what it was before; only the horizontal position of the trend
 * changes.
 *
 * Deliberately NOT part of the seed: run it against demo data, never against a
 * database with real history, where rewriting createdAt would be falsifying
 * the record. It refuses to run unless SPREAD_CONFIRM=yes is set.
 *
 *   SPREAD_CONFIRM=yes node scripts/spread-demo-dates.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

if (process.env.SPREAD_CONFIRM !== "yes") {
  console.error(
    "Refusing to run: this rewrites createdAt on existing rows.\n" +
      "It is for demo data only. Set SPREAD_CONFIRM=yes if that is what you want.",
  );
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const WINDOW_DAYS = 30;

/**
 * Business days weigh more than weekends.
 *
 * A flat random spread looks synthetic in a way people notice without being
 * able to say why — real pipeline has a weekly rhythm. Weekends get a fifth of
 * the weight, which is roughly what a B2B CRM actually shows.
 */
function weightedDayOffset() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const offset = Math.floor(Math.random() * WINDOW_DAYS);
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    if (!weekend || Math.random() < 0.2) return offset;
  }
  return Math.floor(Math.random() * WINDOW_DAYS);
}

/** A timestamp `offset` days ago, at a plausible hour of the working day. */
function backdated(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  d.setHours(9 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60), 0, 0);
  return d;
}

async function spread(table, column, { dateOnly = false, extra = null } = {}) {
  const { data, error } = await db
    .from(table)
    .select("id")
    .is("deletedAt", null);

  if (error) {
    console.log(`  ${table.padEnd(18)} skipped (${error.message})`);
    return;
  }
  if (!data?.length) {
    console.log(`  ${table.padEnd(18)} skipped (no rows)`);
    return;
  }

  let updated = 0;
  for (const row of data) {
    const when = backdated(weightedDayOffset());
    const patch = { [column]: dateOnly ? when.toISOString().slice(0, 10) : when.toISOString() };
    if (extra) Object.assign(patch, extra(when));

    const { error: e } = await db.from(table).update(patch).eq("id", row.id);
    if (e) {
      console.log(`  ${table}: ${row.id} failed — ${e.message}`);
      continue;
    }
    updated += 1;
  }

  console.log(`  ${table.padEnd(18)} ${String(updated).padStart(3)} rows spread over ${WINDOW_DAYS} days`);
}

console.log(`Spreading demo records across the last ${WINDOW_DAYS} days\n`);

await spread("opportunity", "createdAt");
await spread("support_case", "createdAt");
await spread("lead", "createdAt");
await spread("quotation", "createdAt");
await spread("activity", "createdAt");

/**
 * Closed-won deals and cleared payments carry their own dates, and those are
 * what the revenue trends read. A deal created inside the window but closed
 * before it leaves the "won" sparkline empty.
 *
 * Only rows already outside the window are moved, and only forward — a deal
 * that legitimately closed last week keeps its date.
 */
async function pullIntoWindow(table, column, filter) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - WINDOW_DAYS);
  const cutoffKey = cutoff.toISOString().slice(0, 10);

  let query = db.from(table).select(`id, ${column}`).is("deletedAt", null).lt(column, cutoffKey);
  for (const [col, value] of Object.entries(filter ?? {})) query = query.eq(col, value);

  const { data, error } = await query;
  if (error) {
    console.log(`  ${table.padEnd(18)} skipped (${error.message})`);
    return;
  }
  if (!data?.length) {
    console.log(`  ${table.padEnd(18)} nothing outside the window`);
    return;
  }

  let moved = 0;
  for (const row of data) {
    const when = backdated(weightedDayOffset());
    const { error: e } = await db
      .from(table)
      .update({ [column]: when.toISOString().slice(0, 10) })
      .eq("id", row.id);
    if (!e) moved += 1;
  }
  console.log(`  ${table.padEnd(18)} ${String(moved).padStart(3)} ${column} pulled into the window`);
}

await pullIntoWindow("opportunity", "actualCloseDate", { stage: "CLOSED_WON" });
await pullIntoWindow("payment", "paymentDate", { status: "CLEARED" });

console.log("\nDone. The dashboard sparklines now have a shape to draw.");
