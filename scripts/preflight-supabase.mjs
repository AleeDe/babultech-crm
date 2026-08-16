/**
 * Preflight for the Supabase cloud cutover.
 *
 * Checks the connection strings in .env BEFORE any schema push, so a typo or a
 * swapped port fails here with a clear message rather than halfway through
 * creating 64 tables.
 *
 * Run: node scripts/preflight-supabase.mjs
 */
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env" });

const problems = [];
const notes = [];

const dbUrl = process.env.DATABASE_URL ?? "";
const directUrl = process.env.DIRECT_URL ?? "";

if (!dbUrl) problems.push("DATABASE_URL is not set.");
if (!directUrl) problems.push("DIRECT_URL is not set (Prisma errors P1012 without it).");

const isCloud = dbUrl.includes("supabase.com") || dbUrl.includes("supabase.co");

if (isCloud) {
  // Port rules. Getting these backwards is the classic Supabase+Prisma failure:
  // migrations hang or fail intermittently rather than erroring cleanly.
  if (!dbUrl.includes(":6543")) {
    problems.push(
      "DATABASE_URL should use port 6543 (transaction pooler) for the app's " +
        "short-lived server-action connections.",
    );
  }
  if (!dbUrl.includes("pgbouncer=true")) {
    problems.push("DATABASE_URL is missing ?pgbouncer=true — Prisma needs it on the pooler.");
  }
  if (!directUrl.includes(":5432")) {
    problems.push(
      "DIRECT_URL should use port 5432 (session mode). Migrations cannot run " +
        "through the transaction pooler.",
    );
  }
  if (directUrl.includes("pgbouncer=true")) {
    problems.push("DIRECT_URL must NOT carry pgbouncer=true.");
  }
  if (/\[(ref|pw|password|region)\]/i.test(dbUrl + directUrl)) {
    problems.push("A placeholder like [ref] or [pw] is still present — paste the real values.");
  }
  if (/sbp_/.test(dbUrl + directUrl)) {
    problems.push(
      "A sbp_ token appears in a connection string. That is a management-API " +
        "token, not a database password.",
    );
  }
} else {
  notes.push("DATABASE_URL does not look like Supabase cloud — treating as local.");
}

if (problems.length) {
  console.error("\nPreflight FAILED:\n");
  for (const p of problems) console.error("  x " + p);
  console.error("\nSee .env.example for the exact shape.\n");
  process.exit(1);
}

for (const n of notes) console.log("  - " + n);

// Live connectivity check against both URLs.
async function probe(label, url) {
  // Supabase cloud terminates TLS with its own CA; rejectUnauthorized:false
  // keeps this working without shipping a cert bundle. Local ignores it.
  const needsSsl = /supabase\.(com|co)/.test(url);
  const client = new pg.Client({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      "select current_database() as db, version() as version",
    );
    console.log(`  ok ${label}: ${rows[0].db} (${rows[0].version.split(",")[0]})`);
    return true;
  } catch (err) {
    console.error(`  x  ${label}: ${err.message.split("\n")[0]}`);
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

console.log("\nConnectivity:");
const a = await probe("DATABASE_URL (app/pooler)", dbUrl);
const b = await probe("DIRECT_URL  (migrations) ", directUrl);

if (!a || !b) {
  console.error("\nPreflight FAILED: could not connect. Check the password and region.\n");
  process.exit(1);
}

console.log("\nPreflight passed — safe to run the cutover.\n");
