/**
 * Applies a .sql file to the database in DIRECT_URL.
 *
 * Used by the cutover so RLS can be applied without a local psql client, and so
 * it always targets the same database Prisma migrated.
 *
 * Uses the `pg` driver rather than Prisma's $executeRawUnsafe: Prisma sends a
 * single prepared statement, which rejects these files outright because they
 * contain multiple statements and dollar-quoted bodies ($$ ... $$) for the
 * helper functions and DO blocks. node-postgres sends the script as one simple
 * query, which the server parses as a multi-statement batch — the same way psql
 * would.
 *
 * Each file is wrapped in a transaction, so a failure part-way leaves no
 * half-applied policy set.
 *
 * Run: node scripts/apply-sql.mjs prisma/rls/001_scope_helpers.sql
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env" });

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/apply-sql.mjs <file.sql>");
  process.exit(1);
}

// Migrations and DDL must use the session-mode connection: the transaction
// pooler cannot hold the session state these scripts need.
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Neither DIRECT_URL nor DATABASE_URL is set.");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");

// Supabase cloud terminates TLS with its own CA; rejectUnauthorized:false keeps
// this working without shipping a cert bundle. Local connections ignore it.
const needsSsl = /supabase\.(com|co)/.test(url);
const client = new pg.Client({
  connectionString: url,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

try {
  await client.connect();
  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log(`      applied ${file}`);
} catch (err) {
  try {
    await client.query("rollback");
  } catch {
    /* connection may already be unusable */
  }
  console.error(`      FAILED ${file}`);
  console.error("      " + String(err.message).split("\n").slice(0, 4).join("\n      "));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
