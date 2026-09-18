// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Covers recurring contract billing and accounting period locks.
// Usage: node scripts/test-periods-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This pilot only targets the local application.");
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const ids = { operatorRole: randomUUID(), approverRole: randomUUID(), operator: null, approver: null, account: randomUUID(), contract: randomUUID() };
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
const iso = (d) => d.toISOString().slice(0, 10);
const monthsAgo = (n) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)); };
const monthsAhead = (n) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); };
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/period-fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
async function asUser(email, password) {
 const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
 const signIn = await client.auth.signInWithPassword({ email, password });
 if (signIn.error) throw new Error(`Token sign-in failed: ${signIn.error.code ?? signIn.error.message}`);
 return client;
}
// A contract that started three months ago, so three periods are already due.
const contractStart = iso(monthsAgo(3));
const contractEnd = iso(monthsAhead(8));
const closableMonth = iso(monthsAgo(2));
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  { id: ids.operatorRole, name: `QA per operator ${run}`, permissions: ["invoice:read", "invoice:write", "payment:write", "account:read", "contract:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.approverRole, name: `QA per approver ${run}`, permissions: ["invoice:read", "invoice:write", "invoice:approve", "payment:write", "account:read", "contract:read"], dataScope: "ALL", updatedAt: now() },
 ]), "Create temporary roles");
 const passwords = {}; const emails = {};
 for (const role of ["operator", "approver"]) {
  passwords[role] = randomBytes(24).toString("base64url");
  emails[role] = `qa-per-${role}-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({ id: ids[role], fullName: `QA per ${role}`, email: emails[role], roleId: ids[`${role}Role`], status: "ACTIVE", updatedAt: now() }), "Create temporary profile");
 }
 await check(db.from("account").insert({ id: ids.account, accountNumber: `QAPER-${run}`, name: `QA Period Account ${run}`, ownerUserId: ids.approver, updatedAt: now() }), "Create temporary account");
 await check(db.from("contract").insert({
  id: ids.contract, contractNumber: `QAPER-C-${run}`, name: `QA Retainer ${run}`, accountId: ids.account,
  ownerUserId: ids.approver, contractType: "Retainer", status: "ACTIVE",
  startDate: contractStart, endDate: contractEnd, contractValue: 12000, currencyCode: "PKR",
  billingFrequency: "MONTHLY", updatedAt: now(),
 }), "Create temporary contract");

 browser = await chromium.launch({ headless: true });
 const contexts = {}; const pages = {};
 for (const role of ["operator", "approver"]) {
  contexts[role] = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  pages[role] = await contexts[role].newPage();
  const page = pages[role]; currentPage = page;
  page.on("pageerror", error => report.browserErrors.push({ role, message: error.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(emails[role]);
  await page.locator('input[name="password"]').fill(passwords[role]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 30000 });
  await passed(`${role} UI login`);
 }
 const operator = pages.operator, approver = pages.approver;

 // --- The recurring run, through the UI ---
 currentPage = operator;
 await operator.goto(`${base}/invoices`);
 await operator.getByRole("button", { name: "Billing run", exact: false }).click();
 await operator.getByRole("button", { name: "Bill contract periods", exact: true }).click();
 await operator.getByText("draft invoice(s) raised", { exact: false }).waitFor({ timeout: 30000 });
 await operator.screenshot({ path: `${output}/periods-billing-run.png`, fullPage: true });

 const raised = await db.from("invoice").select("id,status,periodStart,periodEnd,totalAmount").eq("contractId", ids.contract).order("periodStart");
 assert.ok(raised.data.length >= 3, `Expected at least three periods, got ${raised.data.length}`);
 await passed(`Recurring run raises one draft per started period (${raised.data.length})`);

 assert.ok(raised.data.every(i => i.status === "DRAFT"), "The run issued an invoice instead of drafting one");
 await passed("Every raised invoice is a draft, not an issued one");

 assert.equal(raised.data[0].periodStart, contractStart, "The first period does not start with the contract");
 assert.ok(raised.data.every(i => i.periodStart && i.periodEnd), "A raised invoice has no period recorded");
 await passed("Each draft records the contract period it covers");

 // 12000 over 12 monthly periods.
 assert.equal(Number(raised.data[0].totalAmount), 1000, "The period amount is not the contract value divided by its periods");
 await passed("The period amount divides the contract value across its periods");

 // --- Running it again must not bill anything twice ---
 const before = raised.data.length;
 await operator.getByRole("button", { name: "Bill contract periods", exact: true }).click();
 await operator.getByText("No contract periods are waiting to be billed", { exact: false }).waitFor({ timeout: 30000 });
 const after = await db.from("invoice").select("id").eq("contractId", ids.contract);
 assert.equal(after.data.length, before, "A second run billed periods again");
 await passed("Running the recurring billing again bills nothing twice");

 // The database refuses a duplicate even if the run's own check is bypassed.
 const operatorClient = await asUser(emails.operator, passwords.operator);
 const duplicate = await operatorClient.from("invoice").insert({
  invoiceNumber: `QAPER-DUP-${run}`, accountId: ids.account, contractId: ids.contract,
  invoiceDate: iso(new Date()), dueDate: iso(monthsAhead(1)), status: "DRAFT", currencyCode: "PKR",
  subtotal: 1000, discountAmount: 0, taxAmount: 0, totalAmount: 1000, paidAmount: 0, outstandingAmount: 1000,
  periodStart: contractStart, periodEnd: raised.data[0].periodEnd, updatedAt: now(),
 });
 assert.ok(duplicate.error, "The same contract period was billed twice through the database");
 await passed("The database refuses a second invoice for the same contract period");

 // --- Closing a month ---
 currentPage = operator;
 await operator.goto(`${base}/finance/periods`);
 await operator.getByRole("heading", { name: "Accounting periods", exact: true }).waitFor();
 assert.equal(await operator.getByRole("button", { name: "Close month", exact: true }).count(), 0);
 await passed("An operator sees the periods page but cannot close a month");

 const operatorClose = await operatorClient.rpc("close_accounting_period", { p_period: closableMonth, p_note: "QA operator attempt" });
 assert.ok(operatorClose.error, "An operator closed a period through the database");
 await passed("The database refuses a close without approval authority");

 currentPage = approver;
 await approver.goto(`${base}/finance/periods`);
 await approver.locator('select[name="periodStart"]').first().selectOption(closableMonth);
 await approver.locator('textarea[name="note"]').first().fill("QA: books reviewed and signed off for this month.");
 await approver.getByRole("button", { name: "Close month", exact: true }).click();
 await approver.getByText("Month closed.", { exact: false }).waitFor({ timeout: 30000 });
 await approver.screenshot({ path: `${output}/periods-closed.png`, fullPage: true });
 const lock = await db.from("accounting_period_lock").select("periodStart,closedById,note").eq("periodStart", closableMonth).single();
 assert.equal(lock.data.closedById, ids.approver);
 await passed("An approver closes a finished month through the UI");

 // The current month must not be closable at all.
 const currentMonth = iso(monthsAgo(0));
 const closeCurrent = await (await asUser(emails.approver, passwords.approver))
  .rpc("close_accounting_period", { p_period: currentMonth, p_note: "QA current month" });
 assert.ok(closeCurrent.error, "The month currently being traded in was closed");
 await passed("The current month cannot be closed");

 // --- What a closed month refuses ---
 const intoClosed = await operatorClient.from("invoice").insert({
  invoiceNumber: `QAPER-CLOSED-${run}`, accountId: ids.account,
  invoiceDate: closableMonth, dueDate: iso(monthsAhead(1)), status: "DRAFT", currencyCode: "PKR",
  subtotal: 500, discountAmount: 0, taxAmount: 0, totalAmount: 500, paidAmount: 0, outstandingAmount: 500,
  updatedAt: now(),
 });
 assert.ok(intoClosed.error, "An invoice was raised into a closed month");
 await passed("A closed month refuses a new invoice");

 const paymentIntoClosed = await operatorClient.from("payment").insert({
  paymentNumber: `QAPER-CLOSEDPAY-${run}`, accountId: ids.account, paymentDate: closableMonth,
  amount: 500, currencyCode: "PKR", paymentMethod: "BANK", updatedAt: now(),
 });
 assert.ok(paymentIntoClosed.error, "A payment was recorded into a closed month");
 await passed("A closed month refuses a new payment");

 // An open month still works, which is what makes the lock a lock and not a wall.
 const intoOpen = await operatorClient.from("payment").insert({
  paymentNumber: `QAPER-OPENPAY-${run}`, accountId: ids.account, paymentDate: iso(new Date()),
  amount: 250, currencyCode: "PKR", paymentMethod: "BANK", updatedAt: now(),
 }).select("id").single();
 assert.equal(intoOpen.error, null, `An open month refused a payment: ${intoOpen.error?.message}`);
 await passed("An open month still accepts financial records");

 // --- Reopening ---
 currentPage = approver;
 await approver.goto(`${base}/finance/periods`);
 await approver.getByText("Closed months", { exact: true }).waitFor();
 const reopenSelect = approver.locator('select[name="periodStart"]').last();
 await reopenSelect.selectOption(closableMonth);
 await approver.locator('textarea[name="note"]').last().fill("QA: a late supplier credit has to go in this month.");
 await approver.getByRole("button", { name: "Reopen month", exact: true }).click();
 await approver.getByText("Month reopened.", { exact: false }).waitFor({ timeout: 30000 });
 const reopened = await db.from("accounting_period_lock").select("reopenedById,reopenNote").eq("periodStart", closableMonth).single();
 assert.equal(reopened.data.reopenedById, ids.approver, "Reopening was not recorded against the month");
 await passed("Reopening is recorded rather than deleting the closure");

 const afterReopen = await operatorClient.from("payment").insert({
  paymentNumber: `QAPER-REOPEN-${run}`, accountId: ids.account, paymentDate: closableMonth,
  amount: 100, currencyCode: "PKR", paymentMethod: "BANK", updatedAt: now(),
 }).select("id").single();
 assert.equal(afterReopen.error, null, `A reopened month still refused a payment: ${afterReopen.error?.message}`);
 await passed("A reopened month accepts records again");

 await approver.reload();
 await approver.getByText("Reopened months", { exact: true }).waitFor();
 await approver.screenshot({ path: `${output}/periods-reopened.png`, fullPage: true });
 await passed("The reopened month is shown with its reason");

 await approver.setViewportSize({ width: 390, height: 844 });
 await approver.goto(`${base}/finance/periods`);
 await approver.getByRole("heading", { name: "Accounting periods", exact: true }).waitFor();
 assert.equal(await approver.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow");
 await passed("Periods page fits 390px viewport");

 assert.equal(report.browserErrors.length, 0, `Browser runtime errors: ${JSON.stringify(report.browserErrors)}`);
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/periods-failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/periods-failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 // Delete only this run's explicitly named fixture IDs, child rows first.
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 // The period lock has to go first, or the invoices dated inside it cannot be removed.
 await clean("Period lock", db.from("accounting_period_lock").delete().eq("periodStart", closableMonth));
 const invoices = await db.from("invoice").select("id").eq("accountId", ids.account);
 const invoiceIds = (invoices.data ?? []).map(i => i.id);
 if (invoiceIds.length) await clean("Invoice lines", db.from("invoice_line").delete().in("invoiceId", invoiceIds));
 await clean("Payment allocations", db.from("payment_allocation").delete().in("invoiceId", invoiceIds.length ? invoiceIds : ["00000000-0000-0000-0000-000000000000"]));
 await clean("Payments", db.from("payment").delete().eq("accountId", ids.account));
 await clean("Invoices", db.from("invoice").delete().eq("accountId", ids.account));
 await clean("Contract", db.from("contract").delete().eq("id", ids.contract));
 await clean("Account", db.from("account").delete().eq("id", ids.account));
 for (const role of ["approver", "operator"]) if (ids[role]) {
  await clean(`${role} profile`, db.from("app_user").delete().eq("id", ids[role]));
  await clean(`${role} auth`, db.auth.admin.deleteUser(ids[role]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.operatorRole, ids.approverRole]));
 const residue = await db.from("account").select("id").eq("id", ids.account);
 report.fixtureAccountRemaining = residue.data?.length ?? null;
 const lockResidue = await db.from("accounting_period_lock").select("periodStart").eq("periodStart", closableMonth);
 report.fixtureLockRemaining = lockResidue.data?.length ?? null;
 await writeFile(`${output}/periods-report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureAccountRemaining: report.fixtureAccountRemaining, fixtureLockRemaining: report.fixtureLockRemaining }, null, 2));
}
