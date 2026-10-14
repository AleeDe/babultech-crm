// Who a hire reports to - in a real browser.
//
// A hire whose contract names a manager whose login has since been switched
// off: the person page says so, the login is created anyway (choosing an
// active manager), and the edit page changes who they report to on the login
// and the contract. A choice that would make a loop is refused. Everything
// created is removed; no email is sent.
//
// Usage: node scripts/test-reports-to-browser.mjs http://localhost:3100
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
const lower = run.toLowerCase();
const now = () => new Date().toISOString();
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what) {
  for (let i = 0; i < 40; i++) {
    const v = await fn();
    if (v) return v;
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const ids = { plainRole: randomUUID(), users: [], staff: randomUUID(), contract: randomUUID(), hire: null };
let browser;

async function makeLogin(name, roleId, status = "ACTIVE") {
  const email = `rto-${name}-${lower}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  await must(db.from("app_user").insert({ id: auth.data.user.id, fullName: `QA ${name} ${run}`, email, roleId, status, updatedAt: now() }), `Login ${name}`);
  ids.users.push(auth.data.user.id);
  return { id: auth.data.user.id, email, password };
}

try {
  const crm = await must(db.from("security_role").select("id").eq("name", "CRM Admin").single(), "CRM Admin");
  await must(db.from("security_role").insert({ id: ids.plainRole, name: `QA RTo Plain ${run}`, permissions: ["project:read"], dataScope: "OWN", updatedAt: now() }), "Role");
  const admin = await makeLogin("admin", crm.id);
  const former = await makeLogin("former", ids.plainRole, "INACTIVE");
  const lead = await makeLogin("lead", ids.plainRole);
  const second = await makeLogin("second", ids.plainRole);
  await must(db.from("staff_profile").insert({ id: ids.staff, profileNumber: `QA-RTO-${run}`, fullName: `QA RTo Hire ${run}`, status: "ACTIVE", updatedAt: now() }), "Profile");
  await must(db.from("employment_contract").insert({
    id: ids.contract, contractNumber: `QA-RTO-${run}`, staffId: ids.staff, contractType: "INTERNSHIP", tenureMonths: 3,
    startDate: today(), endDate: "2099-01-01", jobTitle: "Intern", reportsToUserId: former.id, roleId: ids.plainRole,
    status: "ACTIVE", body: "QA", updatedAt: now(),
  }), "Contract");
  pass("A hire whose contract names a manager whose login is switched off");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  await page.goto(`${base}/people/${ids.staff}`, { waitUntil: "networkidle" });
  await page.getByText(`QA former ${run} (login switched off)`).waitFor();
  pass("The person page shows who they report to, and that the login is switched off");

  // The login: the switched-off manager no longer holds it back.
  await page.getByRole("button", { name: "Create login" }).click();
  await page.getByText(/whose login is switched off\. Choose who they report to now/).waitFor();
  assert.equal(await page.locator('select[name="reportsToUserId"]').inputValue(), "", "Not pre-filled with the switched-off manager");
  await page.locator('input[name="loginEmail"]').fill(`rto-hire-${lower}@example.com`);
  await page.locator('input[name="loginPassword"]').fill(`Pw-${randomBytes(9).toString("base64url")}7Q`);
  await page.locator('select[name="reportsToUserId"]').selectOption(lead.id);
  await page.getByRole("button", { name: "Create login" }).click();
  await page.getByText(/Login created/).waitFor({ timeout: 60000 });
  const hire = await until(async () => (await db.from("app_user").select("id, managerUserId").eq("email", `rto-hire-${lower}@example.com`).maybeSingle()).data, "login");
  ids.hire = hire.id;
  ids.users.push(hire.id);
  assert.equal(hire.managerUserId, lead.id);
  pass("The login is created with the active manager chosen, instead of failing");

  // Edit: change who they report to.
  await page.goto(`${base}/people/${ids.staff}/edit`, { waitUntil: "networkidle" });
  assert.equal(await page.locator('select[name="reportsToUserId"]').inputValue(), lead.id);
  await page.locator('select[name="reportsToUserId"]').selectOption(second.id);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(new RegExp(`/people/${ids.staff}$`), { timeout: 30000 });
  assert.equal((await db.from("app_user").select("managerUserId").eq("id", hire.id).single()).data.managerUserId, second.id, "On the login");
  assert.equal((await db.from("employment_contract").select("reportsToUserId").eq("id", ids.contract).single()).data.reportsToUserId, second.id, "On the contract");
  await page.getByText(`QA second ${run}`).first().waitFor();
  pass("Editing the person changes who they report to, on the login and the contract");

  // A loop is refused: the manager cannot report (however far up) to this person.
  await must(db.from("app_user").update({ managerUserId: hire.id }).eq("id", lead.id), "Lead reports to the hire");
  await page.goto(`${base}/people/${ids.staff}/edit`, { waitUntil: "networkidle" });
  await page.locator('select[name="reportsToUserId"]').selectOption(lead.id);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByText("That would make a loop").waitFor({ timeout: 20000 });
  assert.equal((await db.from("app_user").select("managerUserId").eq("id", hire.id).single()).data.managerUserId, second.id, "Unchanged");
  pass("A choice that would make a reporting loop is refused");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await db.from("audit_history").delete().in("entityId", [ids.staff, ids.contract, ...ids.users]);
  await db.from("employment_contract").delete().eq("staffId", ids.staff);
  await db.from("staff_profile").delete().eq("id", ids.staff);
  for (const user of ids.users) await db.from("app_user").update({ managerUserId: null }).eq("id", user);
  for (const user of ids.users) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record", "team_member"]) await db.from(t).delete().eq("userId", user);
    await db.from("audit_history").delete().eq("changedById", user);
    await db.from("app_user").delete().eq("id", user);
    await db.auth.admin.deleteUser(user).catch(() => {});
  }
  await db.from("security_role").delete().eq("id", ids.plainRole);
  console.log("Temporary data removed.");
}
