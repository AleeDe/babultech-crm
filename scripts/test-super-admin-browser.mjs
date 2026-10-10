// Super Admin and CRM Admin - in a real browser.
//
// Only the Super Admin deletes, and can delete an account whatever is on it:
// the confirmation lists what goes with it (contacts, deals, quotes, cases)
// and what stays (invoices, projects), asks why, and a restore brings it all
// back. A payment still allocated to an invoice is held back. A CRM Admin and
// a Manager see no Delete anywhere; a CRM Admin cannot manage roles, give the
// Super Admin role, or change the Super Admin's login. Everything created is
// removed; no email is sent.
//
// Usage: node scripts/test-super-admin-browser.mjs http://localhost:3100
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
const today = () => new Date().toISOString().slice(0, 10);
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

const ids = {
  superRole: randomUUID(), managerRole: randomUUID(), plainRole: randomUUID(), users: [],
  account: randomUUID(), contact: randomUUID(), deal: randomUUID(), quote: randomUUID(), caseId: randomUUID(),
  invoice: randomUUID(), project: randomUUID(), payment: randomUUID(), allocation: randomUUID(),
};
let browser;

async function makeLogin(name, roleId) {
  const email = `sadm-${name}-${lower}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  await must(db.from("app_user").insert({ id: auth.data.user.id, fullName: `QA ${name} ${run}`, email, roleId, status: "ACTIVE", updatedAt: now() }), `Login ${name}`);
  ids.users.push(auth.data.user.id);
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
const deleted = async (table, id) => Boolean((await db.from(table).select("deletedAt").eq("id", id).single()).data?.deletedAt);

try {
  const crmRole = await must(db.from("security_role").select("id, permissions").eq("name", "CRM Admin").single(), "CRM Admin role");
  assert.deepEqual(crmRole.permissions, ["all:except-delete"]);
  const managerPerms = (await must(db.from("security_role").select("permissions").eq("name", "Manager").single(), "Manager")).permissions;
  await must(db.from("security_role").insert([
    { id: ids.superRole, name: `QA Super ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() },
    { id: ids.managerRole, name: `QA Manager ${run}`, permissions: managerPerms, dataScope: "ALL", updatedAt: now() },
    { id: ids.plainRole, name: `QA Plain ${run}`, permissions: ["project:read"], dataScope: "OWN", updatedAt: now() },
  ]), "Roles");
  const sup = await makeLogin("super", ids.superRole);
  const crm = await makeLogin("crmadmin", crmRole.id);
  const mgr = await makeLogin("manager", ids.managerRole);
  const target = await makeLogin("target", ids.plainRole);
  const u = sup.id;

  await must(db.from("account").insert({ id: ids.account, accountNumber: `QA-SA-${run}`, name: `QA Super Co ${run}`, accountType: "CUSTOMER", ownerUserId: u, updatedAt: now() }), "Account");
  await must(db.from("contact").insert({ id: ids.contact, firstName: "QA Super", lastName: `Contact ${run}`, email: `sadm-contact-${lower}@example.com`, accountId: ids.account, updatedAt: now() }), "Contact");
  await must(db.from("opportunity").insert({ id: ids.deal, opportunityNumber: `QA-SD-${run}`, name: `QA Super Deal ${run}`, accountId: ids.account, ownerUserId: u, stage: "NEGOTIATION", amount: 100, currencyCode: "PKR", expectedCloseDate: today(), updatedAt: now() }), "Deal");
  await must(db.from("quotation").insert({ id: ids.quote, quoteNumber: `QA-SQ-${run}`, opportunityId: ids.deal, accountId: ids.account, versionNumber: 1, status: "ACCEPTED", quoteDate: today(), expiryDate: today(), currencyCode: "PKR", subtotal: 100, totalAmount: 100, updatedAt: now() }), "Quote");
  await must(db.from("support_case").insert({ id: ids.caseId, caseNumber: `QA-SC-${run}`, subject: `QA Super Case ${run}`, description: "QA", accountId: ids.account, ownerUserId: u, status: "CLOSED", priority: "MEDIUM", updatedAt: now() }), "Case");
  await must(db.from("project").insert({ id: ids.project, projectNumber: `QA-SP-${run}`, name: `QA Super Project ${run}`, accountId: ids.account, projectManagerId: u, projectType: "CUSTOMER", billingType: "FIXED", status: "ACTIVE", currencyCode: "PKR", updatedAt: now() }), "Project");
  await must(db.from("invoice").insert({ id: ids.invoice, invoiceNumber: `QA-SI-${run}`, accountId: ids.account, invoiceDate: today(), dueDate: today(), currencyCode: "PKR", status: "SENT", updatedAt: now() }), "Invoice");
  await must(db.from("payment").insert({ id: ids.payment, paymentNumber: `QA-SPAY-${run}`, accountId: ids.account, paymentDate: today(), amount: 10, unallocatedAmount: 0, currencyCode: "PKR", paymentMethod: "BANK", updatedAt: now() }), "Payment");
  await must(db.from("payment_allocation").insert({ id: ids.allocation, paymentId: ids.payment, invoiceId: ids.invoice, allocatedAmount: 10, allocatedById: u }), "Allocation");
  pass("A Super Admin, a CRM Admin, a Manager, and an account with a deal, an accepted quote, a closed case, a project, an invoice and an allocated payment");

  browser = await chromium.launch({ headless: true });

  // --- CRM Admin: everything except delete and roles -----------------------
  const crmPage = await signedIn(crm);
  await crmPage.goto(`${base}/accounts?search=${run}`, { waitUntil: "networkidle" });
  await crmPage.locator(`[data-row-actions="QA Super Co ${run}"]`).getByRole("link", { name: "Edit" }).waitFor();
  assert.equal(await crmPage.getByRole("button", { name: `Delete QA Super Co ${run}` }).count(), 0, "No Delete on the list");
  await crmPage.goto(`${base}/accounts/${ids.account}`, { waitUntil: "networkidle" });
  assert.equal(await crmPage.getByRole("button", { name: /^Delete / }).count(), 0, "No Delete on the record");
  assert.equal(await crmPage.getByRole("link", { name: "Recycle bin" }).count(), 0, "No recycle bin in the menu");
  await crmPage.goto(`${base}/settings`, { waitUntil: "networkidle" });
  await crmPage.getByText("Roles and permissions").waitFor();
  assert.equal(await crmPage.getByRole("button", { name: "Add role" }).count(), 0, "Cannot add roles");
  pass("A CRM Admin can open everything, but has no Delete, no recycle bin and no role editing");

  await crmPage.goto(`${base}/users/${target.id}/edit`, { waitUntil: "networkidle" });
  await crmPage.getByRole("button", { name: new RegExp(`QA Super ${run}`) }).click();
  await crmPage.getByRole("button", { name: "Save user" }).click();
  await crmPage.getByText("Only the Super Admin can give or take away the Super Admin or CRM Admin role.").waitFor({ timeout: 20000 });
  assert.equal((await db.from("app_user").select("roleId").eq("id", target.id).single()).data.roleId, ids.plainRole);
  await crmPage.goto(`${base}/users/${sup.id}/edit`, { waitUntil: "networkidle" });
  await crmPage.getByRole("button", { name: "Save user" }).click();
  await crmPage.getByText("Only the Super Admin can change the Super Admin's login.").waitFor({ timeout: 20000 });
  pass("A CRM Admin cannot give the Super Admin role or change the Super Admin's login");

  // --- Manager: no Delete --------------------------------------------------
  const mgrPage = await signedIn(mgr);
  await mgrPage.goto(`${base}/accounts?search=${run}`, { waitUntil: "networkidle" });
  await mgrPage.locator(`[data-row-actions="QA Super Co ${run}"]`).waitFor();
  assert.equal(await mgrPage.getByRole("button", { name: `Delete QA Super Co ${run}` }).count(), 0);
  pass("A Manager has no Delete either");

  // --- Super Admin: delete anything, with what goes and why ----------------
  const supPage = await signedIn(sup);
  await supPage.goto(`${base}/payments?search=${run}`, { waitUntil: "networkidle" });
  await supPage.getByRole("button", { name: `Delete QA-SPAY-${run}` }).click();
  await supPage.locator("[data-delete-confirm]").getByText("It is allocated to invoices. Remove the allocations first.").waitFor();
  assert.equal(await deleted("payment", ids.payment), false);
  pass("A payment still allocated to an invoice is held back, and the confirmation says why");

  await supPage.goto(`${base}/accounts?search=${run}`, { waitUntil: "networkidle" });
  await supPage.getByRole("button", { name: `Delete QA Super Co ${run}` }).click();
  const box = supPage.locator("[data-delete-confirm]");
  for (const line of ["1 contact", "1 deal", "1 quote", "1 support case", "1 project, still linked to the account", "1 invoice, kept for the books", "1 payment, kept for the books"]) {
    await box.getByText(line, { exact: true }).waitFor();
  }
  assert.equal(await supPage.getByRole("button", { name: `Yes, delete QA Super Co ${run}` }).isDisabled(), true, "Not without a reason");
  await supPage.locator('input[name="deleteReason"]').fill("Test customer, never real");
  await supPage.getByRole("button", { name: `Yes, delete QA Super Co ${run}` }).click();
  // The account goes first, then what belongs to it; wait for the last of them.
  await until(async () => (await deleted("account", ids.account)) && (await deleted("quotation", ids.quote)), "account and its records deleted");
  for (const [table, id] of [["contact", ids.contact], ["opportunity", ids.deal], ["quotation", ids.quote], ["support_case", ids.caseId]]) {
    assert.ok(await deleted(table, id), `${table} goes with the account`);
  }
  assert.equal(await deleted("invoice", ids.invoice), false, "The invoice stays");
  assert.equal(await deleted("project", ids.project), false, "The project stays");
  const why = (await db.from("audit_history").select("newValue, changedById").eq("entityId", ids.account).eq("fieldName", "deleteReason").single()).data;
  assert.deepEqual(why, { newValue: "Test customer, never real", changedById: sup.id });
  pass("The Super Admin deletes an account with a closed case and an accepted quote: contacts, deals, quotes and cases go with it, invoices and projects stay, and the reason is kept");

  await supPage.goto(`${base}/recycle-bin`, { waitUntil: "networkidle" });
  await supPage.locator("tr", { hasText: `QA Super Co ${run}` }).getByRole("button", { name: /Restore/ }).click();
  await until(async () => !(await deleted("account", ids.account)) && !(await deleted("quotation", ids.quote)), "account and its records restored");
  for (const [table, id] of [["contact", ids.contact], ["opportunity", ids.deal], ["quotation", ids.quote], ["support_case", ids.caseId]]) {
    assert.equal(await deleted(table, id), false, `${table} comes back with the account`);
  }
  pass("Restoring the account brings back everything that went with it");

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
  const all = [ids.account, ids.contact, ids.deal, ids.quote, ids.caseId, ids.invoice, ids.project, ids.payment];
  await clean("audit", () => db.from("audit_history").delete().in("entityId", all));
  await clean("allocation", () => db.from("payment_allocation").delete().eq("id", ids.allocation));
  await clean("payment", () => db.from("payment").delete().eq("id", ids.payment));
  await clean("invoice", () => db.from("invoice").delete().eq("id", ids.invoice));
  await clean("project", () => db.from("project").delete().eq("id", ids.project));
  await clean("case", () => db.from("support_case").delete().eq("id", ids.caseId));
  await clean("quote", () => db.from("quotation").delete().eq("id", ids.quote));
  await clean("deal", () => db.from("opportunity").delete().eq("id", ids.deal));
  await clean("contact", () => db.from("contact").delete().eq("id", ids.contact));
  await clean("account", () => db.from("account").delete().eq("id", ids.account));
  for (const user of ids.users) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record"]) await clean(t, () => db.from(t).delete().eq("userId", user));
    await clean("audit by user", () => db.from("audit_history").delete().eq("changedById", user));
    await clean("user", () => db.from("app_user").delete().eq("id", user));
    await db.auth.admin.deleteUser(user).catch(() => {});
  }
  await clean("roles", () => db.from("security_role").delete().in("id", [ids.superRole, ids.managerRole, ids.plainRole]));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
