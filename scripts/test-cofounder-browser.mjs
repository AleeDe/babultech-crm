// Co-founders: onboarding one through the hiring wizard - in a real browser.
//
// An administrator gives an existing colleague a co-founder agreement: no end
// date, equity checked against what other co-founders already hold, areas of
// responsibility, vesting, capital invested. The agreement is written from the
// co-founder template, signed by hand, does not end on its own, and is
// revised by a new agreement that takes over when it starts. Everything
// created is removed; no email is sent.
//
// Usage: node scripts/test-cofounder-browser.mjs http://localhost:3100
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
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

const ids = { adminRole: randomUUID(), plainRole: randomUUID(), admin: null, founder: null, otherStaff: randomUUID(), otherContract: randomUUID(), staff: null };
let browser;

async function makeLogin(name, roleId) {
  const email = `cof-${name}-${lower}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  await must(db.from("app_user").insert({ id: auth.data.user.id, fullName: `QA ${name} ${run}`, email, roleId, status: "ACTIVE", updatedAt: now() }), `Login ${name}`);
  return { id: auth.data.user.id, email, password };
}

try {
  await must(db.from("security_role").insert([
    { id: ids.adminRole, name: `QA Cof Admin ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() },
    { id: ids.plainRole, name: `QA Cof Plain ${run}`, permissions: ["project:read"], dataScope: "OWN", updatedAt: now() },
  ]), "Roles");
  const admin = await makeLogin("admin", ids.adminRole);
  const founder = await makeLogin("founder", ids.plainRole);
  Object.assign(ids, { admin: admin.id, founder: founder.id });

  // Another co-founder already holding 60%, and whatever real agreements exist.
  await must(db.from("staff_profile").insert({ id: ids.otherStaff, profileNumber: `QA-COF-${run}`, fullName: `QA Other Founder ${run}`, status: "ACTIVE", updatedAt: now() }), "Other founder");
  await must(db.from("employment_contract").insert({
    id: ids.otherContract, contractNumber: `QA-COF-${run}`, staffId: ids.otherStaff, contractType: "COFOUNDER", startDate: today(),
    jobTitle: "Co-founder", equityPercent: 60, responsibilities: ["Sales"], status: "ACTIVE", body: "QA", updatedAt: now(),
  }), "Other agreement");
  // As the app counts it: agreements not deleted, of people not deleted.
  const realHeld = ((await db.from("employment_contract").select("equityPercent, staff:staff_profile!inner ( deletedAt )").eq("contractType", "COFOUNDER").is("deletedAt", null).is("staff.deletedAt", null)
    .in("status", ["DRAFT", "SENT", "EMPLOYEE_SIGNED", "SIGNED", "ACTIVE"]).neq("id", ids.otherContract)).data ?? [])
    .reduce((sum, c) => sum + Number(c.equityPercent), 0);
  const fmt = (n) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n)}%`;
  pass("An administrator, a colleague to make co-founder, and another co-founder holding 60%");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  // --- The wizard ----------------------------------------------------------
  await page.goto(`${base}/people/new`, { waitUntil: "networkidle" });
  await page.locator('select[name="existingUserId"]').selectOption(founder.id);
  assert.equal(await page.locator('input[name="fullName"]').inputValue(), `QA founder ${run}`);
  await page.locator('input[name="nationalId"]').fill("35202-1111111-1");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator('select[name="contractType"]').selectOption("COFOUNDER");
  await page.locator("[data-cofounder-term]").waitFor();
  assert.equal(await page.locator('input[name="endDate"]').count(), 0, "No end date for a co-founder");
  assert.equal(await page.locator('select[name="tenureMonths"]').count(), 0, "No tenure for a co-founder");
  assert.equal(await page.locator('input[name="jobTitle"]').inputValue(), "Co-founder");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("heading", { name: "Financials" }).waitFor();
  assert.ok(await page.getByRole("button", { name: /Financials/ }).count(), "The step is called Financials");
  pass("Choosing Co-founder drops the tenure and end date and renames Compensation to Financials");

  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Enter the co-founder's equity, more than 0%.").waitFor();
  await page.locator('input[name="equityPercent"]').fill("50");
  const total = page.locator("[data-equity-total]");
  await total.getByText(fmt(realHeld + 110)).waitFor();
  assert.match(await total.textContent(), /more than 100%/);
  await page.locator('input[name="equityPercent"]').fill("40");
  await total.getByText(fmt(realHeld + 100)).waitFor();
  pass("Equity is required, and the total held by all co-founders is shown, with a warning over 100%");

  await page.locator('input[name="responsibilities"][value="Development"]').check();
  await page.locator('input[name="responsibilities"][value="Research"]').check();
  await page.locator('input[name="extraArea"]').fill(`Finance ${run}`);
  await page.locator('input[name="extraArea"]').press("Enter");
  await page.locator('input[name="vestingMonths"]').fill("48");
  await page.locator('input[name="cliffMonths"]').fill("12");
  await page.locator('input[name="capitalAmount"]').fill("500000");
  await page.locator('select[name="capitalCurrency"]').selectOption("PKR");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("vests in equal monthly parts over 4 years, with a 12-month cliff").waitFor();
  await page.getByRole("button", { name: "Save and prepare contract" }).click();
  await page.waitForURL(/\/people\/contracts\/[0-9a-f-]{36}/, { timeout: 30000 });

  const staff = await until(async () => (await db.from("staff_profile").select("*").eq("userId", founder.id).maybeSingle()).data, "profile");
  ids.staff = staff.id;
  const agreement = (await db.from("employment_contract").select("*").eq("staffId", staff.id).single()).data;
  assert.equal(agreement.contractType, "COFOUNDER");
  assert.equal(agreement.endDate, null);
  assert.equal(agreement.tenureMonths, null);
  assert.equal(Number(agreement.equityPercent), 40);
  assert.deepEqual(agreement.responsibilities, ["Development", "Research", `Finance ${run}`]);
  assert.equal(agreement.vestingMonths, 48);
  assert.equal(agreement.cliffMonths, 12);
  assert.equal(Number(agreement.capitalAmount), 500000);
  for (const words of ["CO-FOUNDER AGREEMENT", "holds 40% of the Company", "- Development", "- Research",
    "vests in equal monthly parts over 4 years, with a 12-month cliff", "PKR 500,000", "in proportion to equity", "35202-1111111-1"]) {
    assert.ok(agreement.body.includes(words), `The agreement says: ${words}`);
  }
  pass("The co-founder agreement is saved with no end date and written from its own template");

  // --- Signed, running with no end ------------------------------------------
  await page.getByRole("button", { name: "Signed on paper instead?" }).click();
  await page.getByRole("button", { name: "Mark as signed" }).click();
  await until(async () => (await db.from("employment_contract").select("status").eq("id", agreement.id).single()).data.status === "ACTIVE", "active");
  await must(db.rpc("people_contract_tick"), "Daily job");
  assert.equal((await db.from("employment_contract").select("status").eq("id", agreement.id).single()).data.status, "ACTIVE", "It never ends on its own");
  // The page reloads itself after marking it signed.
  await page.getByText("Running, with no end date").waitFor({ timeout: 30000 });
  await page.getByText("From", { exact: false }).filter({ hasText: "no end date" }).first().waitFor();
  pass("Signed, it starts and keeps running: the daily job never ends it");

  // --- A revision replaces it -------------------------------------------------
  await page.getByRole("link", { name: "Revise agreement" }).click();
  await page.waitForURL(/contracts\/new\?from=/);
  assert.equal(await page.locator('input[name="equityPercent"]').inputValue(), "40");
  await page.locator("[data-equity-total]").getByText(fmt(realHeld + 100)).waitFor();
  await page.locator('input[name="equityPercent"]').fill("35");
  await page.getByRole("button", { name: "Prepare contract" }).click();
  await page.waitForURL(/\/people\/contracts\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const revision = (await db.from("employment_contract").select("*").eq("previousContractId", agreement.id).single()).data;
  assert.equal(Number(revision.equityPercent), 35);
  await page.getByRole("button", { name: "Signed on paper instead?" }).click();
  await page.getByRole("button", { name: "Mark as signed" }).click();
  await until(async () => (await db.from("employment_contract").select("status").eq("id", revision.id).single()).data.status === "ACTIVE", "revision active");
  assert.equal((await db.from("employment_contract").select("status").eq("id", agreement.id).single()).data.status, "RENEWED");
  pass("A revised agreement counts their current equity once, and replaces the old one when it starts");

  await page.goto(`${base}/people/${staff.id}`, { waitUntil: "networkidle" });
  await page.getByText("35% equity").waitFor();
  assert.equal(await page.getByRole("button", { name: "Create login" }).count(), 0, "They already have a login");
  pass("Their page shows equity instead of pay, and their existing login");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  const failures = [];
  const clean = async (what, fn) => {
    try {
      const r = await fn();
      if (r?.error) failures.push(`${what}: ${r.error.message}`);
    } catch (err) {
      failures.push(`${what}: ${err.message}`);
    }
  };
  for (const staffId of [ids.staff, ids.otherStaff].filter(Boolean)) {
    const contracts = ((await db.from("employment_contract").select("id").eq("staffId", staffId)).data ?? []).map((c) => c.id);
    await clean("audit", () => db.from("audit_history").delete().in("entityId", [staffId, ...contracts]));
    await clean("contracts", () => db.from("employment_contract").delete().eq("staffId", staffId));
    await clean("profile", () => db.from("staff_profile").delete().eq("id", staffId));
  }
  await clean("areas", () => db.from("picklist_value").delete().eq("picklistKey", "cofounder_area").eq("value", `Finance ${run}`));
  for (const user of [ids.admin, ids.founder].filter(Boolean)) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record", "team_member"]) await clean(t, () => db.from(t).delete().eq("userId", user));
    await clean("audit by user", () => db.from("audit_history").delete().eq("changedById", user));
    await clean("user", () => db.from("app_user").delete().eq("id", user));
    await db.auth.admin.deleteUser(user).catch(() => {});
  }
  await clean("roles", () => db.from("security_role").delete().in("id", [ids.adminRole, ids.plainRole]));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
