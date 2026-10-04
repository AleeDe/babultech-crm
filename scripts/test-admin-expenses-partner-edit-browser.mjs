// Administrators' expenses and editing partners - in a real browser.
//
// An administrator's expense needs nobody's approval: one entered on the form
// is approved at once, a draft is approved by pressing Approve, and one already
// waiting (like EXP-2026-00067 was) they approve themselves. A Manager's own
// claim still waits for someone else. A partner is edited from its list row.
// Everything created is removed; no email is sent (example.com).
//
// Usage: node scripts/test-admin-expenses-partner-edit-browser.mjs http://localhost:3100
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
const today = () => now().slice(0, 10);
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

const ids = { adminRole: randomUUID(), managerRole: randomUUID(), admin: null, manager: null, partnerAccount: randomUUID(), partner: randomUUID(), draft: randomUUID(), waiting: randomUUID(), managers: randomUUID(), formExpense: null };
let browser;

async function makeLogin(name, roleId) {
  const email = `aexp-${name}-${lower}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  await must(db.from("app_user").insert({ id: auth.data.user.id, fullName: `QA ${name} ${run}`, email, roleId, status: "ACTIVE", updatedAt: now() }), `Login ${name}`);
  return { id: auth.data.user.id, email, password };
}
async function signedIn(login) {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(login.email);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  return page;
}

try {
  const managerPerms = (await must(db.from("security_role").select("permissions").eq("name", "Manager").single(), "Manager role")).permissions;
  await must(db.from("security_role").insert([
    { id: ids.adminRole, name: `QA AExp Admin ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() },
    { id: ids.managerRole, name: `QA AExp Manager ${run}`, permissions: managerPerms, dataScope: "ALL", updatedAt: now() },
  ]), "Roles");
  const admin = await makeLogin("admin", ids.adminRole);
  const manager = await makeLogin("manager", ids.managerRole);
  ids.admin = admin.id;
  ids.manager = manager.id;

  const category = await must(db.from("expense_category").select("id, name").limit(1).single(), "Category");
  await must(db.from("expense").insert([
    { id: ids.draft, expenseNumber: `QA-AE1-${run}`, categoryId: category.id, expenseDate: today(), amount: 500, currencyCode: "PKR", description: `Admin draft ${run}`, employeeUserId: admin.id, reimbursable: true, approvalStatus: "DRAFT", updatedAt: now() },
    { id: ids.waiting, expenseNumber: `QA-AE2-${run}`, categoryId: category.id, expenseDate: today(), amount: 15000, currencyCode: "PKR", description: `Admin waiting ${run}`, employeeUserId: admin.id, reimbursable: true, approvalStatus: "SUBMITTED", updatedAt: now() },
    { id: ids.managers, expenseNumber: `QA-AE3-${run}`, categoryId: category.id, expenseDate: today(), amount: 700, currencyCode: "PKR", description: `Manager waiting ${run}`, employeeUserId: manager.id, reimbursable: true, approvalStatus: "SUBMITTED", updatedAt: now() },
  ]), "Expenses");
  await must(db.from("account").insert({ id: ids.partnerAccount, accountNumber: `QA-AEP-${run}`, name: `QA AExp Partner Co ${run}`, accountType: "PARTNER", ownerUserId: admin.id, updatedAt: now() }), "Partner account");
  await must(db.from("partner").insert({ id: ids.partner, partnerNumber: `QA-AEP-${run}`, displayName: `QA AExp Partner ${run}`, kind: "COMPANY", accountId: ids.partnerAccount, partnerType: "REFERRAL", status: "ACTIVE", partnerManagerId: admin.id, defaultCommissionPercent: 10, territory: "Old territory", updatedAt: now() }), "Partner");
  pass("An administrator, a Manager, three claims and a partner");

  browser = await chromium.launch({ headless: true });
  const adm = await signedIn(admin);

  // An expense entered on the form by an administrator is approved at once.
  await adm.goto(`${base}/expenses/new`, { waitUntil: "networkidle" });
  await adm.locator('select[name="categoryId"]').selectOption(category.id);
  await adm.locator('input[name="amount"]').fill("1234");
  await adm.locator('input[name="reimbursable"]').uncheck();
  await adm.locator('[name="description"]').last().fill(`Admin form claim ${run}`);
  await adm.getByRole("button", { name: "Record expense" }).click();
  const formClaim = await until(async () => (await db.from("expense").select("id, approvalStatus").eq("description", `Admin form claim ${run}`).maybeSingle()).data, "form claim");
  ids.formExpense = formClaim.id;
  assert.equal(formClaim.approvalStatus, "APPROVED");
  pass("An administrator's expense entered on the form is approved at once");

  // A draft: the button says Approve, and approves it.
  await adm.goto(`${base}/expenses/${ids.draft}`, { waitUntil: "networkidle" });
  await adm.getByRole("button", { name: "Approve", exact: true }).click();
  await until(async () => (await db.from("expense").select("approvalStatus").eq("id", ids.draft).single()).data?.approvalStatus === "APPROVED", "draft approved");
  pass("An administrator's draft is approved with one press, no second person");

  // One already waiting, like EXP-2026-00067: the administrator approves it.
  await adm.goto(`${base}/approvals`, { waitUntil: "networkidle" });
  const row = adm.locator("li, tr, div").filter({ hasText: `QA-AE2-${run}` }).last();
  assert.equal(await adm.getByText("Your own claim - someone else has to approve it.").count(), 0, "Not blocked for the administrator");
  await adm.goto(`${base}/expenses/${ids.waiting}`, { waitUntil: "networkidle" });
  await adm.getByRole("button", { name: /^Approve/ }).first().click();
  await until(async () => (await db.from("expense").select("approvalStatus").eq("id", ids.waiting).single()).data?.approvalStatus === "APPROVED", "waiting claim approved");
  void row;
  pass("A claim of theirs already waiting is approved by the administrator");

  // A Manager's own claim still needs someone else.
  const mgr = await signedIn(manager);
  await mgr.goto(`${base}/expenses/${ids.managers}`, { waitUntil: "networkidle" });
  await mgr.getByText("you cannot approve your own claim").waitFor({ timeout: 15000 });
  assert.equal((await db.from("expense").select("approvalStatus").eq("id", ids.managers).single()).data.approvalStatus, "SUBMITTED");
  pass("A Manager still cannot approve their own claim");

  // Partners: Edit on the list row, and the form saves.
  await adm.goto(`${base}/partners?search=${run}`, { waitUntil: "networkidle" });
  await adm.locator(`[data-row-actions="QA AExp Partner ${run}"]`).getByRole("link", { name: "Edit" }).click();
  await adm.waitForURL(new RegExp(`/partners/${ids.partner}/edit`), { timeout: 30000 });
  await adm.locator('input[name="territory"]').fill(`Lahore ${run}`);
  await adm.locator('input[name="defaultCommissionPercent"]').fill("12.5");
  await adm.getByRole("button", { name: "Save changes" }).click();
  const p = await until(async () => {
    const r = (await db.from("partner").select("territory, defaultCommissionPercent, status").eq("id", ids.partner).single()).data;
    return r?.territory === `Lahore ${run}` ? r : null;
  }, "partner saved");
  assert.equal(Number(p.defaultCommissionPercent), 12.5);
  assert.equal(p.status, "ACTIVE", "Fields not on the change keep their value");
  await adm.waitForURL(new RegExp(`/partners/${ids.partner}$`), { timeout: 30000 });
  await adm.getByRole("link", { name: "Edit", exact: true }).waitFor({ timeout: 15000 });
  pass("A partner is edited from its list row, and the page has an Edit button");

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
  const expenseIds = [ids.draft, ids.waiting, ids.managers, ids.formExpense].filter(Boolean);
  await clean("expenses", () => db.from("expense").delete().in("id", expenseIds));
  await clean("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await clean("account", () => db.from("account").delete().eq("id", ids.partnerAccount));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [...expenseIds, ids.partner, ids.partnerAccount]));
  for (const user of [ids.admin, ids.manager].filter(Boolean)) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record"]) await clean(t, () => db.from(t).delete().eq("userId", user));
    await clean("user", () => db.from("app_user").delete().eq("id", user));
    await db.auth.admin.deleteUser(user).catch(() => {});
  }
  await clean("roles", () => db.from("security_role").delete().in("id", [ids.adminRole, ids.managerRole]));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
