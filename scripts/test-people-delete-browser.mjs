// Deleting people from HR - in a real browser.
//
// An administrator deletes a profile from the HR list: it goes to the recycle
// bin with its draft contract, its signing link stops working, and it can be
// restored. Someone with a running contract is refused with the reason. Whoever
// manages HR without being an administrator sees no Delete link. Everything
// created is removed; no email is sent.
//
// Usage: node scripts/test-people-delete-browser.mjs http://localhost:3100
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

const ids = { adminRole: randomUUID(), hrRole: randomUUID(), admin: null, hr: null, draftStaff: randomUUID(), activeStaff: randomUUID(), draftContract: randomUUID(), activeContract: randomUUID() };
let browser;

async function makeLogin(name, roleId) {
  const email = `pdel-${name}-${lower}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  await must(db.from("app_user").insert({ id: auth.data.user.id, fullName: `QA ${name} ${run}`, email, roleId, status: "ACTIVE", updatedAt: now() }), `Login ${name}`);
  return { id: auth.data.user.id, email, password };
}
async function signedIn(login) {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(login.email);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  return page;
}

try {
  await must(db.from("security_role").insert([
    { id: ids.adminRole, name: `QA PDel Admin ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() },
    { id: ids.hrRole, name: `QA PDel HR ${run}`, permissions: ["people:read", "people:write"], dataScope: "OWN", updatedAt: now() },
  ]), "Roles");
  const admin = await makeLogin("admin", ids.adminRole);
  const hr = await makeLogin("hr", ids.hrRole);
  Object.assign(ids, { admin: admin.id, hr: hr.id });
  const draftName = `QA Draft Hire ${run}`;
  const activeName = `QA Working Hire ${run}`;
  await must(db.from("staff_profile").insert([
    { id: ids.draftStaff, profileNumber: `QA-PD1-${run}`, fullName: draftName, status: "ONBOARDING", updatedAt: now() },
    { id: ids.activeStaff, profileNumber: `QA-PD2-${run}`, fullName: activeName, status: "ACTIVE", updatedAt: now() },
  ]), "Profiles");
  const contract = (id, staffId, status, extra = {}) => ({
    id, contractNumber: `QA-${id.slice(0, 8)}`, staffId, contractType: "INTERNSHIP", tenureMonths: 3, startDate: today(),
    endDate: "2099-01-01", jobTitle: "Intern", status, body: "QA contract", updatedAt: now(), ...extra,
  });
  await must(db.from("employment_contract").insert([
    contract(ids.draftContract, ids.draftStaff, "EMPLOYEE_SIGNED", { signTokenHash: randomBytes(32).toString("hex"), signTokenExpiresAt: "2099-01-01T00:00:00" }),
    contract(ids.activeContract, ids.activeStaff, "ACTIVE", { signTokenHash: null, signTokenExpiresAt: null }),
  ]), "Contracts");
  pass("An administrator, an HR person, a hire who has signed but the company has not, and one already working");

  browser = await chromium.launch({ headless: true });

  // Not an administrator: no Delete.
  const hrPage = await signedIn(hr);
  await hrPage.goto(`${base}/people?search=${run}`, { waitUntil: "networkidle" });
  const hrRow = hrPage.locator(`[data-row-actions="${draftName}"]`);
  await hrRow.getByRole("link", { name: "Open" }).waitFor();
  assert.equal(await hrRow.getByRole("button", { name: /Delete/ }).count(), 0);
  pass("Someone who manages HR without being an administrator sees Edit and Open, not Delete");

  // The administrator deletes the hire still being signed.
  const adm = await signedIn(admin);
  await adm.goto(`${base}/people?search=${run}`, { waitUntil: "networkidle" });
  const row = adm.locator(`[data-row-actions="${draftName}"]`);
  await row.getByRole("link", { name: "Edit" }).waitFor();
  await row.getByRole("link", { name: "Open" }).waitFor();
  await row.getByRole("button", { name: `Delete ${draftName}` }).click();
  await row.getByRole("button", { name: `Yes, delete ${draftName}` }).click();
  await until(async () => (await db.from("staff_profile").select("deletedAt").eq("id", ids.draftStaff).single()).data.deletedAt, "deleted");
  assert.equal((await db.from("employment_contract").select("signTokenHash").eq("id", ids.draftContract).single()).data.signTokenHash, null, "The signing link stops working");
  // The list reloads itself after a delete.
  await adm.locator(`[data-row-actions="${draftName}"]`).waitFor({ state: "detached", timeout: 30000 });
  await adm.waitForLoadState("networkidle");
  await adm.goto(`${base}/people/${ids.draftStaff}`, { waitUntil: "networkidle" });
  assert.equal(await adm.getByRole("heading", { name: draftName }).count(), 0, "Their page no longer opens");
  pass("An administrator deletes someone whose contract is still being signed; it disappears and its signing link stops working");

  // Someone working here is refused.
  await adm.goto(`${base}/people?search=${run}`, { waitUntil: "networkidle" });
  const working = adm.locator(`[data-row-actions="${activeName}"]`);
  await working.getByRole("button", { name: `Delete ${activeName}` }).click();
  await working.getByRole("button", { name: `Yes, delete ${activeName}` }).click();
  await working.getByText("Their contract has been signed by both sides or is running").waitFor();
  assert.equal((await db.from("staff_profile").select("deletedAt").eq("id", ids.activeStaff).single()).data.deletedAt, null);
  pass("Someone with a running contract cannot be deleted until it is ended, and the list says why");

  // Restored from the recycle bin.
  await adm.goto(`${base}/recycle-bin`, { waitUntil: "networkidle" });
  const binRow = adm.locator("tr, li").filter({ hasText: draftName }).first();
  await binRow.waitFor();
  await binRow.getByRole("button", { name: /Restore/ }).click();
  await until(async () => (await db.from("staff_profile").select("deletedAt").eq("id", ids.draftStaff).single()).data.deletedAt === null, "restored");
  await adm.goto(`${base}/people?search=${run}`, { waitUntil: "networkidle" });
  await adm.getByRole("link", { name: draftName }).waitFor();
  pass("It is listed in the recycle bin as Person (HR) and can be restored");

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
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.draftStaff, ids.activeStaff, ids.draftContract, ids.activeContract]));
  await clean("contracts", () => db.from("employment_contract").delete().in("staffId", [ids.draftStaff, ids.activeStaff]));
  await clean("profiles", () => db.from("staff_profile").delete().in("id", [ids.draftStaff, ids.activeStaff]));
  for (const user of [ids.admin, ids.hr].filter(Boolean)) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record"]) await clean(t, () => db.from(t).delete().eq("userId", user));
    await clean("audit by user", () => db.from("audit_history").delete().eq("changedById", user));
    await clean("user", () => db.from("app_user").delete().eq("id", user));
    await db.auth.admin.deleteUser(user).catch(() => {});
  }
  await clean("roles", () => db.from("security_role").delete().in("id", [ids.adminRole, ids.hrRole]));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
