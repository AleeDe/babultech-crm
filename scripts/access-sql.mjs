// SQL runner for the access rollout. Token comes from env or stdin, never a file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
// .env.local first: it holds the management token, kept out of .env so it is
// never mistaken for app configuration. dotenv does not override, so a value
// in .env.local wins over the same key in .env.
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const [mode, path, ...testPaths] = process.argv.slice(2);
if (!["read", "check", "apply"].includes(mode) || !path) {
  throw new Error("Usage: node scripts/access-sql.mjs read|check|apply file.sql [checks.sql]");
}
const token = process.env.SUPABASE_ACCESS_TOKEN || readFileSync(0, "utf8").trim();
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname;
const ref = host.split(".")[0];
const sql = readFileSync(resolve(path), "utf8");
const checks = testPaths.map((testPath) => readFileSync(resolve(testPath), "utf8")).join("\n");
let query;
if (mode === "read") query = `BEGIN READ ONLY; ${sql}\nCOMMIT;`;
if (mode === "check") query = `BEGIN; SET LOCAL lock_timeout = '5s'; ${sql}\n${checks}\nROLLBACK;`;
if (mode === "apply") {
  const match = path.replaceAll("\\", "/").match(/\/([0-9]{14})_([a-z0-9_]+)\.sql$/);
  if (!match) throw new Error("Apply expects a timestamped migration path.");
  const verification = checks ? `SAVEPOINT access_verification; ${checks}\nROLLBACK TO SAVEPOINT access_verification; RELEASE SAVEPOINT access_verification;` : "";
  query = `BEGIN; SET LOCAL lock_timeout = '5s'; ${sql}\n${verification}\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('${match[1]}','${match[2]}',ARRAY[]::text[]); COMMIT; SELECT 'Applied ${match[1]}; verification fixtures rolled back' AS result;`;
}
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
});
const result = await response.json();
if (!response.ok) {
  console.error(JSON.stringify(result));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ mode, result }, null, 2));
}
