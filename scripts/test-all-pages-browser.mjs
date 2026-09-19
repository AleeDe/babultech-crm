// Real Chromium + local app + a temporary administrator. Never prints secrets.
// Opens every static page and reports any that error, so a broken query is
// found here rather than by whoever opens the page next.
// Usage: node scripts/test-all-pages-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This pilot only targets the local application.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const ids = { role: randomUUID(), user: null };
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const now = () => new Date().toISOString();

/** Every static route under src/app/(app), skipping dynamic segments. */
function routes(dir = "src/app/(app)", prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Route groups like (app) do not appear in the URL; dynamic segments need
      // a real id, so they are covered by the workflow-specific pilots instead.
      if (entry.startsWith("[")) continue;
      const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
      found.push(...routes(full, prefix + segment));
    } else if (entry === "page.tsx") {
      found.push(prefix || "/");
    }
  }
  return found;
}

const paths = [...new Set(routes())].sort();
const report = { run, checked: paths.length, ok: [], broken: [], browserErrors: [] };
let browser;
try {
 const roleInsert = await db.from("security_role").insert({ id: ids.role, name: `QA sweep ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() });
 if (roleInsert.error) throw new Error(`Create role: ${roleInsert.error.message}`);
 const password = randomBytes(24).toString("base64url");
 const email = `qa-sweep-${run}@example.com`;
 const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
 if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
 ids.user = auth.data.user.id;
 const profileInsert = await db.from("app_user").insert({ id: ids.user, fullName: `QA sweep`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now() });
 if (profileInsert.error) throw new Error(`Create profile: ${profileInsert.error.message}`);

 browser = await chromium.launch({ headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const page = await context.newPage();
 page.on("pageerror", error => report.browserErrors.push({ url: page.url(), message: error.message }));

 await page.goto(`${base}/login`);
 await page.locator('input[name="email"]').fill(email);
 await page.locator('input[name="password"]').fill(password);
 await page.getByRole("button", { name: "Sign in", exact: true }).click();
 await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 30000 });
 console.log(`Signed in. Checking ${paths.length} pages.\n`);

 for (const path of paths) {
  const response = await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" }).catch(() => null);
  // Next renders errors into the page, so the status alone is not enough.
  const body = await page.locator("body").innerText().catch(() => "");
  const status = response?.status() ?? 0;
  const failure =
    status >= 500 ? `HTTP ${status}` :
    /permission denied|Could not load|Unhandled Runtime Error|Application error|Internal Server Error/i.test(body)
      ? (body.match(/(permission denied[^\n]*|Could not load[^\n]*|Application error[^\n]*)/i)?.[1] ?? "error text on page")
      : null;

  if (failure) {
   report.broken.push({ path, failure: failure.slice(0, 160) });
   console.log(`BROKEN  ${path}\n        ${failure.slice(0, 140)}`);
   await page.screenshot({ path: `${output}/sweep-${path.replace(/\//g, "_") || "root"}.png`, fullPage: true }).catch(() => {});
  } else {
   report.ok.push(path);
   console.log(`ok      ${path}`);
  }
 }
} catch (error) {
 report.failed = error instanceof Error ? error.message : String(error);
 console.error(`FAIL ${report.failed}`);
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 // Cleanup has to be loud. A fixture left in the live database looks like a
 // real member of staff to everything that counts users.
 if (ids.user) {
  const profile = await db.from("app_user").delete().eq("id", ids.user);
  if (profile.error) console.error(`CLEANUP FAILED, profile: ${profile.error.message}`);
  const auth = await db.auth.admin.deleteUser(ids.user);
  if (auth.error) console.error(`CLEANUP FAILED, auth: ${auth.error.message}`);
 }
 const role = await db.from("security_role").delete().eq("id", ids.role);
 if (role.error) console.error(`CLEANUP FAILED, role: ${role.error.message}`);
 const residue = await db.from("app_user").select("id").eq("id", ids.user ?? "00000000-0000-0000-0000-000000000000");
 report.fixtureUserRemaining = residue.data?.length ?? null;
 if (report.fixtureUserRemaining) {
  console.error(`CLEANUP FAILED: the temporary user ${ids.user} is still in the database.`);
  process.exitCode = 1;
 }
 await writeFile(`${output}/page-sweep-report.json`, JSON.stringify(report, null, 2));
 console.log(`\n${report.ok.length} ok, ${report.broken.length} broken, of ${report.checked} pages.`);
 if (report.browserErrors.length) console.log(`${report.browserErrors.length} browser runtime errors.`);
 if (report.broken.length) process.exitCode = 1;
}
