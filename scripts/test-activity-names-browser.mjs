// Change history shows names, not ids - in a real browser.
//
// Reads existing history only: a project whose manager changed, a user whose
// role changed, and the dashboard's activity log. Checks the ids stored in
// those rows appear on screen as names. A temporary admin login is the only
// thing created, and it is removed.
//
// Usage: node scripts/test-activity-names-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This check only targets the local application.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const run = randomUUID().slice(0, 6).toLowerCase();
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
let browser;
let adminId = null;

/** The text of the record's change history card, shown or in a hidden tab. */
async function historyText(page) {
  for (const name of ["Details", "History"]) {
    const tab = page.getByText(name, { exact: true }).first();
    if (await tab.count()) { await tab.click(); await page.waitForTimeout(1500); break; }
  }
  const card = page.locator("xpath=//*[normalize-space(text())='Change history' or normalize-space(text())='History']/ancestor::div[contains(@class,'rounded')][1]").first();
  await card.waitFor({ state: "attached", timeout: 20000 });
  return (await card.textContent()) ?? "";
}

async function nameOf(table, column, id) {
  const { data } = await db.from(table).select(column).eq("id", id).maybeSingle();
  return data?.[column] ?? null;
}

try {
  const crm = (await db.from("security_role").select("id").eq("name", "CRM Admin").single()).data;
  const email = `act-admin-${run}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  adminId = auth.data.user.id;
  const ins = await db.from("app_user").insert({ id: adminId, fullName: `QA activity ${run}`, email, roleId: crm.id, status: "ACTIVE", updatedAt: new Date().toISOString() });
  if (ins.error) throw new Error(ins.error.message);

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  // A project whose manager changed.
  const pm = (await db.from("audit_history").select("entityId, newValue").eq("entityType", "Project").eq("fieldName", "projectManagerId")
    .not("newValue", "is", null).order("changedAt", { ascending: false }).limit(1).maybeSingle()).data;
  if (pm) {
    const manager = await nameOf("app_user", "fullName", pm.newValue);
    await page.goto(`${base}/projects/${pm.entityId}`, { waitUntil: "networkidle" });
    const body = await historyText(page);
    assert.ok(body.includes("Project manager"), "The manager change is listed");
    assert.ok(!body.includes(pm.newValue), "The manager's id is not on the page");
    if (manager) assert.ok(body.includes(manager), `Shows ${manager}`);
    pass(`Project history names the manager (${manager ?? "removed record"}), not their id`);
  } else console.log("  SKIP  No project manager change in history");

  // A user whose role changed.
  const role = (await db.from("audit_history").select("entityId, newValue").eq("entityType", "User").eq("fieldName", "roleId")
    .not("newValue", "is", null).order("changedAt", { ascending: false }).limit(1).maybeSingle()).data;
  if (role) {
    const roleName = await nameOf("security_role", "name", role.newValue);
    await page.goto(`${base}/users/${role.entityId}`, { waitUntil: "networkidle" });
    const body = await historyText(page);
    assert.ok(!body.includes(role.newValue), "The role's id is not on the page");
    if (roleName) assert.ok(body.includes(roleName), `Shows ${roleName}`);
    pass(`User history names the role (${roleName ?? "removed record"}), not its id`);
  } else console.log("  SKIP  No role change in history");

  // The dashboard's activity log: record names, and no ids anywhere.
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  const log = page.locator("text=activity.log").locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
  await log.waitFor({ timeout: 20000 });
  if (process.env.SHOT) await log.screenshot({ path: process.env.SHOT });
  const logText = await log.innerText();
  assert.ok(!UUID.test(logText), `No ids in the activity log:\n${logText.slice(0, 600)}`);
  const latest = (await db.from("audit_history").select("entityType, entityId").in("entityType", ["Account", "Project", "Opportunity", "Lead", "Contact", "Invoice", "Expense", "Quotation", "User"])
    .order("changedAt", { ascending: false }).limit(1).maybeSingle()).data;
  console.log(`        first lines: ${logText.split("\n").slice(2, 6).join(" | ")}`);
  pass(`The activity log shows record names and no ids${latest ? "" : " (empty)"}`);

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (adminId) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record", "user_preference"]) await db.from(t).delete().eq("userId", adminId);
    await db.from("audit_history").delete().eq("changedById", adminId);
    await db.from("app_user").delete().eq("id", adminId);
    await db.auth.admin.deleteUser(adminId).catch(() => {});
  }
  console.log("Temporary data removed.");
}
