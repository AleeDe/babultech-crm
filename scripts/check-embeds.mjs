// Runs every PostgREST embed the application uses, and reports the ones the
// database refuses.
//
// Adding a second foreign key between two tables makes every bare embed
// between them ambiguous, and PostgREST fails the WHOLE query rather than
// guessing. That is how one migration took down login for everybody: loadUser
// embeds contact, attribution added contact.sourcePartnerUserId -> app_user,
// and from then on every user read as "not active".
//
// A typecheck cannot see this and the unit tests do not touch Postgres, so it
// needs its own pass. Read-only.
//
// Usage: node scripts/check-embeds.mjs
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
config({ path: ".env", quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/** Every .ts/.tsx under src. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Pull `.from("x").select("...")` pairs out of a file.
 *
 * Deliberately simple: it catches the common shape rather than parsing
 * TypeScript. A select built from a variable is missed, which is why the
 * constants are scanned separately below.
 */
const CALL = /\.from\(\s*["'`](\w+)["'`]\s*\)[\s\S]{0,80}?\.select\(\s*(["'`])([\s\S]*?)\2/g;

const found = new Map();
for (const file of walk("src")) {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(CALL)) {
    const [, table, , select] = m;
    // Template literals with ${} interpolation cannot be run as-is.
    if (select.includes("${")) continue;
    const key = `${table}::${select.replace(/\s+/g, " ").trim()}`;
    if (!found.has(key)) found.set(key, { table, select, file });
  }
}

console.log(`Checking ${found.size} distinct queries against the database\n`);

const broken = [];
for (const { table, select, file } of found.values()) {
  const { error } = await db.from(table).select(select).limit(1);
  if (!error) continue;
  // Only the structural failures matter here. A missing column in a query
  // built for another schema, or a permission refusal, is a different problem.
  if (/more than one relationship|could not find a relationship|ambiguous/i.test(error.message)) {
    broken.push({ table, select, file, message: error.message.split("\n")[0] });
  }
}

if (broken.length === 0) {
  console.log("No ambiguous or broken embeds.");
} else {
  console.log(`${broken.length} query/queries the database refuses:\n`);
  for (const b of broken) {
    console.log(`  ${b.file}`);
    console.log(`    from("${b.table}").select("${b.select.slice(0, 90)}${b.select.length > 90 ? "…" : ""}")`);
    console.log(`    ${b.message}\n`);
  }
  process.exitCode = 1;
}
