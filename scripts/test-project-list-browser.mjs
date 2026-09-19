// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Regression cover for the Projects and Users lists after project_member lost
// its table-level SELECT grant in 20260918000003.
// Usage: node scripts/test-project-list-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This pilot only targets the local application.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const ids = { pmRole: randomUUID(), adminRole: randomUUID(), pm: null, admin: null, member: null, project: randomUUID(), task: randomUUID() };
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/projectlist-fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  { id: ids.pmRole, name: `QA list pm ${run}`, permissions: ["project:*", "account:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.adminRole, name: `QA list admin ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() },
 ]), "Create temporary roles");

 const passwords = {}; const emails = {};
 for (const role of ["pm", "admin", "member"]) {
  passwords[role] = randomBytes(24).toString("base64url");
  emails[role] = `qa-list-${role}-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({
   id: ids[role], fullName: `QA list ${role}`, email: emails[role],
   roleId: role === "admin" ? ids.adminRole : ids.pmRole, status: "ACTIVE", updatedAt: now(),
  }), "Create temporary profile");
 }

 await check(db.from("project").insert({ id: ids.project, projectNumber: `QALIST-${run}`, name: `QA List Project ${run}`, projectManagerId: ids.pm, projectType: "INTERNAL", billingType: "FIXED", status: "PLANNING", updatedAt: now() }), "Create temporary project");
 // Two members with rates set, so the count is non-trivial and the rate columns
 // are genuinely present on the rows being read.
 await check(db.from("project_member").insert([
  { projectId: ids.project, userId: ids.pm, active: true, projectRole: "Manager", billingRate: 5000, costRate: 3000, updatedAt: now() },
  { projectId: ids.project, userId: ids.member, active: true, projectRole: "Member", billingRate: 4000, costRate: 2500, updatedAt: now() },
 ]), "Assign temporary members");
 await check(db.from("project_task").insert({ id: ids.task, projectId: ids.project, name: "QA list task", assignedUserId: ids.member, billable: false, updatedAt: now() }), "Create temporary task");

 browser = await chromium.launch({ headless: true });
 const pages = {};
 for (const role of ["pm", "admin"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  pages[role] = await context.newPage();
  const page = pages[role]; currentPage = page;
  page.on("pageerror", error => report.browserErrors.push({ role, message: error.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(emails[role]);
  await page.locator('input[name="password"]').fill(passwords[role]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 30000 });
 }
 await passed("Staff sign in");

 // --- The Projects list, which is what broke ---
 currentPage = pages.pm;
 await pages.pm.goto(`${base}/projects`);
 await pages.pm.getByRole("heading", { name: "Projects", exact: false }).waitFor({ timeout: 30000 });
 const projectsText = await pages.pm.locator("body").innerText();
 assert.ok(!projectsText.includes("permission denied"), "The Projects list still reports a permission error");
 assert.ok(!projectsText.includes("Could not load projects"), "The Projects list failed to load");
 await pages.pm.getByText(`QA List Project ${run}`, { exact: false }).waitFor();
 await pages.pm.screenshot({ path: `${output}/projectlist-projects.png`, fullPage: true });
 await passed("The Projects list loads and shows the project");

 // The member count has to be right, not merely absent.
 const projectRow = pages.pm.locator("tr, article").filter({ hasText: `QA List Project ${run}` }).first();
 const rowText = await projectRow.innerText();
 assert.ok(/\b2\b/.test(rowText), `The member count is not shown on the row: ${rowText.replace(/\s+/g, " ").slice(0, 120)}`);
 await passed("The member count is correct, not silently zero");

 // --- The Users list, which had the same embed ---
 currentPage = pages.admin;
 await pages.admin.goto(`${base}/users`);
 await pages.admin.getByRole("heading", { name: "Users", exact: false }).waitFor({ timeout: 30000 });
 const usersText = await pages.admin.locator("body").innerText();
 assert.ok(!usersText.includes("permission denied"), "The Users list reports a permission error");
 assert.ok(!usersText.includes("Could not load users"), "The Users list failed to load");
 await pages.admin.locator("tr, article").filter({ hasText: `QA list pm` }).first().waitFor({ timeout: 30000 });
 await passed("The Users list loads with its membership counts");

 // --- The user detail page, which selected project_member with * ---
 await pages.admin.goto(`${base}/users/${ids.pm}`);
 const detailText = await pages.admin.locator("body").innerText();
 assert.ok(!detailText.includes("permission denied"), "The user detail page reports a permission error");
 await pages.admin.getByText(`QA List Project ${run}`, { exact: false }).waitFor({ timeout: 30000 });
 await passed("The user detail page loads its project memberships");

 // --- The rate columns must still be unreadable ---
 const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
 const signIn = await anon.auth.signInWithPassword({ email: emails.pm, password: passwords.pm });
 assert.equal(signIn.error, null, "Could not sign the PM in for the rate check");
 const rates = await anon.from("project_member").select("id,billingRate,costRate").eq("projectId", ids.project);
 assert.ok(rates.error, "A project manager could read the member rate columns");
 await passed("Member rate columns are still unreadable, which is why count() cannot be used");

 const safe = await anon.from("project_member").select("id,projectId,userId,active").eq("projectId", ids.project);
 assert.equal(safe.error, null, `The non-rate columns became unreadable: ${safe.error?.message}`);
 assert.equal((safe.data ?? []).length, 2, "The member rows are not readable");
 await passed("The non-rate columns are readable, so the count can be taken from the rows");

 // Neither page may show a rate.
 assert.ok(!projectsText.includes("5000") && !projectsText.includes("3000"), "A rate appeared on the Projects list");
 assert.ok(!detailText.includes("5000") && !detailText.includes("3000"), "A rate appeared on the user detail page");
 await passed("No member rate is rendered on either page");

 assert.equal(report.browserErrors.length, 0, `Browser runtime errors: ${JSON.stringify(report.browserErrors)}`);
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/projectlist-failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/projectlist-failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 await clean("Task", db.from("project_task").delete().eq("id", ids.task));
 await clean("Members", db.from("project_member").delete().eq("projectId", ids.project));
 await clean("Project", db.from("project").delete().eq("id", ids.project));
 for (const role of ["member", "admin", "pm"]) if (ids[role]) {
  await clean(`${role} profile`, db.from("app_user").delete().eq("id", ids[role]));
  await clean(`${role} auth`, db.auth.admin.deleteUser(ids[role]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.pmRole, ids.adminRole]));
 const residue = await db.from("project").select("id").eq("id", ids.project);
 report.fixtureProjectRemaining = residue.data?.length ?? null;
 await writeFile(`${output}/projectlist-report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureProjectRemaining: report.fixtureProjectRemaining }, null, 2));
}
