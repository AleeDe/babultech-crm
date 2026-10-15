// A project's Work log tab - in a real browser.
//
// "Log work" sits at the top and opens the form there, the entries come right
// under it (latest 10, then "Show all"), and the summary follows. A saved
// entry appears straight away, on the same tab. Entries and Summary fold away
// and the choice is remembered. Everything created is removed.
//
// Usage: node scripts/test-work-log-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This check only targets the local application.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const run = randomUUID().slice(0, 6).toUpperCase();
const now = () => new Date().toISOString();
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
const ids = { project: randomUUID(), user: null };
let browser;

try {
  const crm = await must(db.from("security_role").select("id").eq("name", "CRM Admin").single(), "CRM Admin");
  const email = `wlog-${run.toLowerCase()}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({ id: ids.user, fullName: `QA worklog ${run}`, email, roleId: crm.id, status: "ACTIVE", updatedAt: now() }), "Login");
  await must(db.from("project").insert({ id: ids.project, projectNumber: `QA-WL-${run}`, name: `QA Work Log ${run}`, projectManagerId: ids.user, projectType: "INTERNAL", billingType: "FIXED", status: "ACTIVE", updatedAt: now() }), "Project");
  await must(db.from("project_member").insert({ projectId: ids.project, userId: ids.user, active: true, projectRole: "Developer", updatedAt: now() }), "Member");
  const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  await must(db.from("time_log").insert(Array.from({ length: 12 }, (_, i) => ({
    id: randomUUID(), userId: ids.user, projectId: ids.project, workDate: day(i + 1), hours: 2,
    description: `QA seeded entry ${i + 1}`, billable: true, approvalStatus: "DRAFT", updatedAt: now(),
  }))), "Entries");
  pass("A project with 12 logged entries");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  await page.goto(`${base}/projects/${ids.project}`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Work log/ }).click();
  await page.waitForURL(/tab=activity/);
  const logButton = page.getByRole("button", { name: "Log work" });
  const entries = page.getByRole("button", { name: /^Entries \(12\)/ });
  const summary = page.getByRole("button", { name: /^Summary/ });
  await entries.waitFor();
  const y = async (l) => (await l.boundingBox()).y;
  assert.ok((await y(logButton)) < (await y(entries)), "Log work above the entries");
  assert.ok((await y(entries)) < (await y(summary)), "Entries above the summary");
  pass("The tab reads: Log work, then Entries, then Summary");

  assert.equal(await page.getByText(/^QA seeded entry \d+$/).count(), 10);
  await page.getByRole("button", { name: "Show all 12" }).click();
  assert.equal(await page.getByText(/^QA seeded entry \d+$/).count(), 12);
  pass("The latest 10 entries show, and Show all lists the rest");

  await logButton.click();
  const form = page.getByRole("button", { name: /^Save \d+ entr/ });
  await form.waitFor();
  assert.ok((await y(page.getByPlaceholder("Fixed the duplicate-receipt bug"))) < (await y(entries)), "The form opens above the entries");
  await page.locator('input[type="number"]').first().fill("1.5");
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
  await page.getByPlaceholder("Fixed the duplicate-receipt bug").fill(`QA new entry ${run}`);
  await form.click();
  await page.getByText(`QA new entry ${run}`).waitFor({ timeout: 30000 });
  assert.match(page.url(), /tab=activity/);
  await page.getByRole("button", { name: /^Entries \(13\)/ }).waitFor();
  pass("Log work opens the form at the top, and the saved entry appears straight away on the same tab");

  await page.getByRole("button", { name: /^Entries/ }).click();
  assert.equal(await page.getByText(/^QA seeded entry \d+$/).count(), 0);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Entries/ }).waitFor();
  assert.equal(await page.getByText(/^QA seeded entry \d+$/).count(), 0, "Still folded after a reload");
  await page.getByRole("button", { name: /^Entries/ }).click();
  await page.getByText("QA seeded entry 1", { exact: true }).waitFor();
  pass("Entries fold away, and stay folded after a reload until opened again");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await db.from("time_log").delete().eq("projectId", ids.project);
  await db.from("project_member").delete().eq("projectId", ids.project);
  await db.from("audit_history").delete().eq("entityId", ids.project);
  await db.from("project").delete().eq("id", ids.project);
  if (ids.user) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record", "user_preference"]) await db.from(t).delete().eq("userId", ids.user);
    await db.from("audit_history").delete().eq("changedById", ids.user);
    await db.from("app_user").delete().eq("id", ids.user);
    await db.auth.admin.deleteUser(ids.user).catch(() => {});
  }
  console.log("Temporary data removed.");
}
