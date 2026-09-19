// Real Chromium + local app + a temporary administrator. Never prints secrets.
// Opens every existing project's detail page. The list page working does not
// mean the detail pages do: they render far more panels.
// Usage: node scripts/test-project-detail-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This pilot only targets the local application.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const ids = { role: randomUUID(), user: null };
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const now = () => new Date().toISOString();
const report = { run, ok: [], broken: [], browserErrors: [] };
let browser;
try {
 const roleInsert = await db.from("security_role").insert({ id: ids.role, name: `QA detail ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() });
 if (roleInsert.error) throw new Error(`Create role: ${roleInsert.error.message}`);
 const password = randomBytes(24).toString("base64url");
 const email = `qa-detail-${run}@example.com`;
 const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
 if (auth.error) throw new Error(`Create identity: ${auth.error.message}`);
 ids.user = auth.data.user.id;
 const profile = await db.from("app_user").insert({ id: ids.user, fullName: "QA detail", email, roleId: ids.role, status: "ACTIVE", updatedAt: now() });
 if (profile.error) throw new Error(`Create profile: ${profile.error.message}`);

 // Every real project, so a page that only breaks on certain data is caught.
 const projects = await db.from("project").select("id,projectNumber,name,projectType,status").is("deletedAt", null).order("projectNumber");
 if (projects.error) throw new Error(`Read projects: ${projects.error.message}`);
 console.log(`Checking ${projects.data.length} project detail pages.\n`);

 browser = await chromium.launch({ headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const page = await context.newPage();
 page.on("pageerror", error => report.browserErrors.push({ url: page.url(), message: error.message }));

 await page.goto(`${base}/login`);
 await page.locator('input[name="email"]').fill(email);
 await page.locator('input[name="password"]').fill(password);
 await page.getByRole("button", { name: "Sign in", exact: true }).click();
 await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 60000 });

 for (const project of projects.data) {
  const response = await page.goto(`${base}/projects/${project.id}`, { waitUntil: "domcontentloaded" }).catch(() => null);
  const body = await page.locator("body").innerText().catch(() => "");
  const status = response?.status() ?? 0;
  const failure =
   status >= 500 ? `HTTP ${status}` :
   /permission denied|Could not load|Runtime TypeError|Unhandled Runtime Error|Application error|Cannot read properties/i.test(body)
    ? (body.match(/(Cannot read properties[^\n]*|permission denied[^\n]*|Could not load[^\n]*|Application error[^\n]*)/i)?.[1] ?? "error text on page")
    : null;

  const label = `${project.projectNumber} (${project.projectType}/${project.status})`;
  if (failure) {
   report.broken.push({ id: project.id, label, failure: failure.slice(0, 200) });
   console.log(`BROKEN  ${label}\n        ${failure.slice(0, 160)}`);
   await page.screenshot({ path: `${output}/detail-${project.projectNumber}.png`, fullPage: true }).catch(() => {});
  } else {
   report.ok.push(label);
   console.log(`ok      ${label}`);
  }
 }
} catch (error) {
 report.failed = error instanceof Error ? error.message : String(error);
 console.error(`FAIL ${report.failed}`);
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 if (ids.user) { await db.from("app_user").delete().eq("id", ids.user); await db.auth.admin.deleteUser(ids.user); }
 await db.from("security_role").delete().eq("id", ids.role);
 await writeFile(`${output}/project-detail-report.json`, JSON.stringify(report, null, 2));
 console.log(`\n${report.ok.length} ok, ${report.broken.length} broken.`);
 if (report.browserErrors.length) {
  console.log(`${report.browserErrors.length} browser runtime errors:`);
  for (const e of report.browserErrors.slice(0, 5)) console.log(`  ${e.message.slice(0, 140)}`);
 }
 if (report.broken.length) process.exitCode = 1;
}
