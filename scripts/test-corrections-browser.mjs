// Correcting processed records - in a real browser.
//
// A Manager finds an approved expense claim read-only and cannot delete a
// closed case or a lost deal. An administrator corrects, each with a reason:
// the approved claim, the converted lead (still converted afterwards), the
// issued invoice (its wording only, its amounts untouched), the cleared payment
// and the approved supplier bill. A draft supplier bill is edited by the Manager
// directly. The reasons, the field changes and the owner's notification are
// checked. Everything created is removed; no email is sent (example.com).
//
// Usage: node scripts/test-corrections-browser.mjs http://localhost:3100
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
async function until(fn, what, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const id = () => randomUUID();
const ids = {
  adminRole: id(), managerRole: id(), admin: null, manager: null, account: id(), lead: id(), deal: id(), caseId: id(),
  invoice: id(), payment: id(), billApproved: id(), billDraft: id(), expense: id(),
};
let browser;
const pages = [];

async function makeLogin(name, roleId) {
  const email = `corr-${name}-${lower}@example.com`;
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
  pages.push(page);
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(login.email);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  return page;
}

async function open(page, url) {
  for (let i = 0; i < 3; i++) {
    try {
      return await page.goto(url, { waitUntil: "networkidle" });
    } catch (err) {
      if (!String(err.message).includes("ERR_ABORTED") || i === 2) throw err;
      await wait(1000);
    }
  }
}

/** On a locked edit page, as an administrator: give a reason and open the correction. */
async function correct(page, url, reason) {
  await open(page, url);
  await page.getByLabel("Reason for the correction").fill(reason);
  await page.getByRole("button", { name: "Correct it" }).click();
  await page.getByText("Correcting:").waitFor({ timeout: 30000 });
}

try {
  // --- Setup -------------------------------------------------------------------------------
  const managerPerms = (await must(db.from("security_role").select("permissions").eq("name", "Manager").single(), "Manager role")).permissions;
  await must(db.from("security_role").insert([
    { id: ids.adminRole, name: `QA Corr Admin ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() },
    { id: ids.managerRole, name: `QA Corr Manager ${run}`, permissions: managerPerms, dataScope: "ALL", updatedAt: now() },
  ]), "Roles");
  const admin = await makeLogin("admin", ids.adminRole);
  const manager = await makeLogin("manager", ids.managerRole);
  ids.admin = admin.id;
  ids.manager = manager.id;
  const m = manager.id;

  await must(db.from("account").insert({ id: ids.account, accountNumber: `QA-CR-${run}`, name: `QA Corrections Co ${run}`, accountType: "CUSTOMER", ownerUserId: m, updatedAt: now() }), "Account");
  await must(db.from("lead").insert({ id: ids.lead, leadNumber: `QA-CRL-${run}`, firstName: "Converted", lastName: `Person ${run}`, email: `corr-lead-${lower}@example.com`, jobTitle: "Wrong title", ownerUserId: m, status: "CONVERTED", convertedAt: now(), convertedAccountId: ids.account, updatedAt: now() }), "Converted lead");
  await must(db.from("opportunity").insert({ id: ids.deal, opportunityNumber: `QA-CRD-${run}`, name: `QA Lost deal ${run}`, accountId: ids.account, ownerUserId: m, stage: "CLOSED_LOST", lossReason: "Price", amount: 0, currencyCode: "PKR", expectedCloseDate: today(), updatedAt: now() }), "Lost deal");
  const contact = await must(db.from("contact").insert({ id: id(), accountId: ids.account, firstName: "Case", lastName: `Contact ${run}`, email: `corr-contact-${lower}@example.com`, updatedAt: now() }).select("id").single(), "Contact");
  await must(db.from("support_case").insert({ id: ids.caseId, caseNumber: `QA-CRC-${run}`, subject: `QA Closed case ${run}`, description: "x", accountId: ids.account, contactId: contact.id, ownerUserId: m, status: "CLOSED", resolution: "Fixed", source: "EMAIL", updatedAt: now() }), "Closed case");
  await must(db.from("invoice").insert({ id: ids.invoice, invoiceNumber: `QA-CRI-${run}`, accountId: ids.account, invoiceDate: today(), dueDate: today(), currencyCode: "PKR", status: "SENT", subtotal: 1000, totalAmount: 1000, outstandingAmount: 1000, notes: "Old note", preparedById: m, updatedAt: now() }), "Issued invoice");
  await must(db.from("payment").insert({ id: ids.payment, paymentNumber: `QA-CRP-${run}`, accountId: ids.account, paymentDate: today(), amount: 50, unallocatedAmount: 50, currencyCode: "PKR", paymentMethod: "BANK", status: "CLEARED", referenceNumber: "WRONG-REF", updatedAt: now() }), "Cleared payment");
  await must(db.from("vendor_bill").insert([
    { id: ids.billApproved, billNumber: `QA-CRB1-${run}`, vendorAccountId: ids.account, billDate: today(), dueDate: today(), currencyCode: "PKR", status: "APPROVED", vendorInvoiceNumber: "OLD-1", subtotal: 0, totalAmount: 0, outstandingAmount: 0, updatedAt: now() },
    { id: ids.billDraft, billNumber: `QA-CRB2-${run}`, vendorAccountId: ids.account, billDate: today(), dueDate: today(), currencyCode: "PKR", status: "DRAFT", vendorInvoiceNumber: "OLD-2", subtotal: 0, totalAmount: 0, outstandingAmount: 0, updatedAt: now() },
  ]), "Supplier bills");
  for (const bill of [ids.billApproved, ids.billDraft]) {
    await must(db.from("vendor_bill_line").insert({ vendorBillId: bill, description: "Hosting", quantity: 1, unitCost: 100, lineTotal: 100, sortOrder: 0 }), "Bill line");
  }
  const category = await must(db.from("expense_category").select("id").limit(1).single(), "Expense category");
  await must(db.from("expense").insert({ id: ids.expense, expenseNumber: `QA-CRE-${run}`, categoryId: category.id, expenseDate: today(), amount: 100, currencyCode: "PKR", description: `Wrong description ${run}`, employeeUserId: m, reimbursable: true, approvalStatus: "APPROVED", updatedAt: now() }), "Approved claim");
  pass("An administrator, a Manager, and processed records of seven kinds");

  browser = await chromium.launch({ headless: true });

  // --- The Manager: read-only once processed -----------------------------------------------
  const mgr = await signedIn(manager);
  await open(mgr, `${base}/expenses/${ids.expense}/edit`);
  await mgr.getByText("It is approved. Only an administrator can change it now.").waitFor({ timeout: 20000 });
  assert.equal(await mgr.getByRole("button", { name: "Save changes" }).count(), 0, "No form for the Manager");
  await open(mgr, `${base}/expenses/${ids.expense}`);
  assert.equal(await mgr.getByRole("button", { name: "Correct", exact: true }).count(), 0, "No Correct for the Manager");
  pass("A Manager sees an approved claim as read-only, with no Correct button");

  await open(mgr, `${base}/cases?search=${run}`);
  await mgr.getByText(`QA Closed case ${run}`).first().waitFor({ timeout: 20000 });
  assert.equal(await mgr.getByRole("button", { name: `Delete QA Closed case ${run}`, exact: true }).count(), 0);
  await open(mgr, `${base}/opportunities?search=${run}`);
  await mgr.getByText(`QA Lost deal ${run}`).first().waitFor({ timeout: 20000 });
  assert.equal(await mgr.getByRole("button", { name: `Delete QA Lost deal ${run}`, exact: true }).count(), 0);
  pass("A Manager has no Delete at all: only the Super Admin deletes");

  // A draft supplier bill is the Manager's to edit, directly.
  await open(mgr, `${base}/vendor-bills/${ids.billDraft}/edit`);
  await mgr.locator('input[name="vendorInvoiceNumber"]').fill(`NEW-2-${run}`);
  await mgr.getByRole("button", { name: "Save changes" }).click();
  await until(async () => (await db.from("vendor_bill").select("vendorInvoiceNumber").eq("id", ids.billDraft).single()).data?.vendorInvoiceNumber === `NEW-2-${run}`, "draft bill saved");
  pass("A Manager edits a draft supplier bill on its new edit screen");

  // --- The administrator: corrections with a reason ------------------------------------------
  const adm = await signedIn(admin);

  // From the record's own page: Correct asks why, then opens the form.
  await open(adm, `${base}/expenses/${ids.expense}`);
  await adm.getByRole("button", { name: "Correct", exact: true }).click();
  assert.equal(await adm.getByRole("button", { name: "Correct it" }).isDisabled(), true, "A reason is required");
  await adm.getByLabel("Reason for the correction").fill("Entered against the wrong description");
  await adm.getByRole("button", { name: "Correct it" }).click();
  await adm.waitForURL(new RegExp(`/expenses/${ids.expense}/edit`), { timeout: 30000 });
  await adm.getByText("Correcting:").waitFor({ timeout: 20000 });
  await adm.locator('form [name="description"]').first().fill(`Taxi to the client ${run}`);
  await adm.getByRole("button", { name: "Save changes" }).click();
  const claim = await until(async () => {
    const r = (await db.from("expense").select("description, approvalStatus").eq("id", ids.expense).single()).data;
    return r?.description === `Taxi to the client ${run}` ? r : null;
  }, "claim corrected");
  assert.equal(claim.approvalStatus, "APPROVED", "It stays approved");
  const corr = await must(db.from("record_correction").select("reason, savedAt, openedById").eq("entityId", ids.expense).single(), "Correction");
  assert.equal(corr.reason, "Entered against the wrong description");
  assert.ok(corr.savedAt);
  assert.equal(corr.openedById, admin.id);
  const told = await must(db.from("notification").select("title, body").eq("userId", m).eq("kind", "RECORD_CORRECTED").eq("entityId", ids.expense), "Owner told");
  assert.equal(told.length, 1);
  assert.equal(told[0].body, "Entered against the wrong description");
  const history = await must(db.from("audit_history").select("fieldName, newValue").eq("entityId", ids.expense), "History");
  assert.ok(history.some((h) => h.fieldName === "description" && h.newValue === `Taxi to the client ${run}`), "The change is in the history");
  assert.ok(history.some((h) => h.fieldName === "correction" && /wrong description/.test(h.newValue)), "The reason is in the history");
  pass("An administrator corrects an approved claim: reason kept, change in history, still approved, owner told");

  // The converted lead: corrected, still converted.
  await correct(adm, `${base}/leads/${ids.lead}/edit`, "Job title was mistyped");
  await adm.locator('input[name="jobTitle"]').fill("Head of IT");
  await adm.getByRole("button", { name: "Save changes" }).click();
  const lead = await until(async () => {
    const r = (await db.from("lead").select("jobTitle, status").eq("id", ids.lead).single()).data;
    return r?.jobTitle === "Head of IT" ? r : null;
  }, "lead corrected");
  assert.equal(lead.status, "CONVERTED");
  pass("A converted lead is corrected and stays converted");

  // The issued invoice: its wording, not its amounts.
  await correct(adm, `${base}/invoices/${ids.invoice}/edit`, "PO number missing from the notes");
  await adm.getByText("Wording, dates and references").waitFor({ timeout: 15000 });
  await adm.locator("#wording-notes").fill(`PO 4471 ${run}`);
  await adm.getByRole("button", { name: "Save correction" }).click();
  const inv = await until(async () => {
    const r = (await db.from("invoice").select("notes, totalAmount, status").eq("id", ids.invoice).single()).data;
    return r?.notes === `PO 4471 ${run}` ? r : null;
  }, "invoice corrected");
  assert.equal(Number(inv.totalAmount), 1000, "The amount is untouched");
  assert.equal(inv.status, "SENT");
  pass("An issued invoice's wording is corrected; its amount and status are untouched");

  // The cleared payment, on its new edit screen.
  await correct(adm, `${base}/payments/${ids.payment}/edit`, "Bank reference was copied wrongly");
  await adm.locator("#payment-reference").fill(`TT-${run}`);
  await adm.getByRole("button", { name: "Save changes" }).click();
  await until(async () => (await db.from("payment").select("referenceNumber").eq("id", ids.payment).single()).data?.referenceNumber === `TT-${run}`, "payment corrected");
  pass("A cleared payment is corrected on its new edit screen");

  // The approved supplier bill.
  await correct(adm, `${base}/vendor-bills/${ids.billApproved}/edit`, "Supplier's invoice number was wrong");
  await adm.locator('input[name="vendorInvoiceNumber"]').fill(`NEW-1-${run}`);
  await adm.getByRole("button", { name: "Save changes" }).click();
  const bill = await until(async () => {
    const r = (await db.from("vendor_bill").select("vendorInvoiceNumber, status").eq("id", ids.billApproved).single()).data;
    return r?.vendorInvoiceNumber === `NEW-1-${run}` ? r : null;
  }, "bill corrected");
  assert.equal(bill.status, "APPROVED");
  pass("An approved supplier bill is corrected and stays approved");

  // The administrator may delete a processed record.
  await open(adm, `${base}/cases?search=${run}`);
  await adm.getByRole("button", { name: `Delete QA Closed case ${run}`, exact: true }).click();
  await adm.locator('input[name="deleteReason"]').fill("Raised in error");
  await adm.getByRole("button", { name: `Yes, delete QA Closed case ${run}`, exact: true }).click();
  await until(async () => (await db.from("support_case").select("deletedById").eq("id", ids.caseId).single()).data?.deletedById === admin.id, "case deleted");
  pass("The Super Admin deletes the closed case");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} catch (err) {
  const { tmpdir } = await import("node:os");
  console.error(`Screenshots are in ${tmpdir()}.`);
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `${tmpdir()}/corrections-${i}.png`, fullPage: true }).catch(() => {});
  throw err;
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
  const all = Object.values(ids).filter((v) => typeof v === "string");
  await clean("corrections", () => db.from("record_correction").delete().in("entityId", all));
  await clean("expense", () => db.from("expense").delete().eq("id", ids.expense));
  await clean("bill lines", () => db.from("vendor_bill_line").delete().in("vendorBillId", [ids.billApproved, ids.billDraft]));
  await clean("bills", () => db.from("vendor_bill").delete().in("id", [ids.billApproved, ids.billDraft]));
  await clean("payment", () => db.from("payment").delete().eq("id", ids.payment));
  await clean("invoice", () => db.from("invoice").delete().eq("id", ids.invoice));
  await clean("case", () => db.from("support_case").delete().eq("id", ids.caseId));
  await clean("deal", () => db.from("opportunity").delete().eq("id", ids.deal));
  await clean("lead", () => db.from("lead").delete().eq("id", ids.lead));
  await clean("contacts", () => db.from("contact").delete().eq("accountId", ids.account));
  await clean("account", () => db.from("account").delete().eq("id", ids.account));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", all));
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
