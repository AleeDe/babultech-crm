// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Covers customer subscriptions: whole-period billing, quantity changes, pause,
// and the rule that a period is never billed twice.
// Usage: node scripts/test-subscriptions-browser.mjs http://localhost:3100
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
const ids = {
 salesRole: randomUUID(), financeRole: randomUUID(), sales: null, finance: null,
 account: randomUUID(), product: randomUUID(), subscription: randomUUID(),
};
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
const monthStart = (back) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1)).toISOString().slice(0, 10); };
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/subscription-fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
async function asUser(email, password) {
 const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
 const signIn = await client.auth.signInWithPassword({ email, password });
 if (signIn.error) throw new Error(`Token sign-in failed: ${signIn.error.code ?? signIn.error.message}`);
 return client;
}
// Starts two months ago, so three periods are already due.
const startDate = monthStart(2);
const plan = { id: randomUUID(), name: "Pro Monthly", billingType: "MONTHLY", unitOfMeasure: "user" };
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  { id: ids.salesRole, name: `QA sub sales ${run}`, permissions: ["opportunity:read", "opportunity:write", "account:read", "invoice:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.financeRole, name: `QA sub finance ${run}`, permissions: ["invoice:read", "invoice:write", "invoice:issue", "account:read"], dataScope: "ALL", updatedAt: now() },
 ]), "Create temporary roles");

 const passwords = {}; const emails = {};
 for (const role of ["sales", "finance"]) {
  passwords[role] = randomBytes(24).toString("base64url");
  emails[role] = `qa-sub-${role}-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({ id: ids[role], fullName: `QA sub ${role}`, email: emails[role], roleId: ids[`${role}Role`], status: "ACTIVE", updatedAt: now() }), "Create temporary profile");
 }

 await check(db.from("account").insert({ id: ids.account, accountNumber: `QASUB-${run}`, name: `QA Sub Account ${run}`, accountType: "CUSTOMER", ownerUserId: ids.sales, updatedAt: now() }), "Create temporary account");
 await check(db.from("product").insert({ id: ids.product, productCode: `QASUB-P-${run}`, name: `QA BabulPOS ${run}`, productType: "SUBSCRIPTION", active: true, updatedAt: now() }), "Create temporary product");

 const salesClient = await asUser(emails.sales, passwords.sales);
 const financeClient = await asUser(emails.finance, passwords.finance);

 // --- Sales records what the customer agreed to ---
 const created = await salesClient.rpc("save_customer_subscription", {
  p_id: ids.subscription, p_account: ids.account, p_product: ids.product, p_plan: plan,
  p_quantity: 10, p_unit_price: 500, p_currency: "PKR", p_frequency: "MONTHLY",
  p_start: startDate, p_end: null, p_auto_renew: true, p_notes: "QA agreement",
 });
 assert.equal(created.error, null, `Sales could not create a subscription: ${created.error?.message}`);
 const draft = await db.from("customer_subscription").select("status,subscriptionNumber,plan").eq("id", ids.subscription).single();
 assert.equal(draft.data.status, "DRAFT", "A new subscription should start as a draft");
 assert.ok(draft.data.subscriptionNumber.startsWith("SUB-"), "No subscription number was assigned");
 await passed("Sales records a customer agreement, which starts as a draft");

 // The plan is a snapshot: changing the catalogue must not rewrite it.
 await check(db.from("price_book").insert({ productId: ids.product, name: "Standard", currencyCode: "PKR", licenseCost: 9999, updatedAt: now() }), "Change the catalogue price");
 const afterCatalogue = await db.from("customer_subscription").select("unitPrice,plan").eq("id", ids.subscription).single();
 assert.equal(Number(afterCatalogue.data.unitPrice), 500, "A catalogue price change rewrote the agreed price");
 await passed("Changing the catalogue price does not change what the customer agreed to");

 // Finance cannot manage agreements: that is commercial authority.
 const financeAttempt = await financeClient.rpc("save_customer_subscription", {
  p_id: randomUUID(), p_account: ids.account, p_product: ids.product, p_plan: plan,
  p_quantity: 5, p_unit_price: 100, p_currency: "PKR", p_frequency: "MONTHLY",
  p_start: startDate, p_end: null, p_auto_renew: true, p_notes: null,
 });
 assert.ok(financeAttempt.error, "Finance created a customer agreement without commercial authority");
 await passed("Creating an agreement needs commercial authority, not billing authority");

 // --- Nothing bills while it is a draft ---
 const draftRun = await financeClient.from("customer_subscription").select("id").eq("status", "ACTIVE");
 assert.equal((draftRun.data ?? []).length, 0, "A draft subscription appeared as active");
 await passed("A draft agreement is not picked up for billing");

 await check(salesClient.rpc("set_subscription_status", { p_subscription: ids.subscription, p_status: "ACTIVE", p_reason: "QA: customer signed" }), "Activate");
 await passed("Sales activates the agreement");

 // --- The billing run, through the UI ---
 browser = await chromium.launch({ headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const page = await context.newPage();
 currentPage = page;
 page.on("pageerror", error => report.browserErrors.push({ message: error.message }));
 await page.goto(`${base}/login`);
 await page.locator('input[name="email"]').fill(emails.finance);
 await page.locator('input[name="password"]').fill(passwords.finance);
 await page.getByRole("button", { name: "Sign in", exact: true }).click();
 await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 30000 });

 await page.goto(`${base}/invoices`);
 await page.getByRole("button", { name: "Billing run", exact: false }).click();
 await page.getByRole("button", { name: "Bill subscriptions", exact: true }).click();
 await page.getByText("draft invoice(s) raised", { exact: false }).waitFor({ timeout: 30000 });
 await page.screenshot({ path: `${output}/subscriptions-billing-run.png`, fullPage: true });

 const invoices = await db.from("invoice").select("id,status,periodStart,totalAmount").eq("subscriptionId", ids.subscription).order("periodStart");
 assert.ok(invoices.data.length >= 3, `Expected at least three periods, got ${invoices.data.length}`);
 assert.ok(invoices.data.every(i => i.status === "DRAFT"), "The run issued an invoice instead of drafting one");
 assert.equal(Number(invoices.data[0].totalAmount), 5000, "10 users at 500 should bill 5000");
 await passed(`Billing raises one draft per started period (${invoices.data.length}), at the agreed price`);

 const marked = await db.from("customer_subscription").select("billedThrough").eq("id", ids.subscription).single();
 assert.ok(marked.data.billedThrough, "The billed marker did not advance");
 await passed("Each billed period is marked, so the next run knows where it got to");

 // --- Running it again bills nothing twice ---
 const before = invoices.data.length;
 await page.getByRole("button", { name: "Bill subscriptions", exact: true }).click();
 await page.getByText("No subscription periods are waiting to be billed", { exact: false }).waitFor({ timeout: 30000 });
 const after = await db.from("invoice").select("id").eq("subscriptionId", ids.subscription);
 assert.equal(after.data.length, before, "A second run billed periods again");
 await passed("Running the billing again bills nothing twice");

 // And the database refuses a duplicate even around the run.
 const duplicate = await financeClient.from("invoice").insert({
  invoiceNumber: `QASUB-DUP-${run}`, accountId: ids.account, subscriptionId: ids.subscription,
  invoiceDate: new Date().toISOString().slice(0, 10), dueDate: monthStart(-1), status: "DRAFT",
  currencyCode: "PKR", subtotal: 5000, discountAmount: 0, taxAmount: 0, totalAmount: 5000,
  paidAmount: 0, outstandingAmount: 5000, periodStart: startDate, periodEnd: startDate, updatedAt: now(),
 });
 assert.ok(duplicate.error, "The same subscription period was billed twice through the database");
 await passed("The database refuses a second invoice for the same subscription period");

 // --- A quantity change applies from the next period, not this one ---
 const billedThrough = marked.data.billedThrough;
 const backdated = await salesClient.rpc("change_subscription_quantity", {
  p_id: randomUUID(), p_subscription: ids.subscription, p_quantity: 30,
  p_effective: billedThrough, p_reason: "QA: trying to rewrite an invoiced period",
 });
 assert.ok(backdated.error, "A quantity change rewrote a period that was already invoiced");
 await passed("A period already invoiced cannot have its quantity rewritten");

 const nextPeriod = monthStart(-1);
 await check(salesClient.rpc("change_subscription_quantity", {
  p_id: randomUUID(), p_subscription: ids.subscription, p_quantity: 15,
  p_effective: nextPeriod, p_reason: "QA: customer added five staff",
 }), "Record a quantity change");
 const unchanged = await db.from("invoice").select("totalAmount").eq("subscriptionId", ids.subscription).order("periodStart").limit(1).single();
 assert.equal(Number(unchanged.data.totalAmount), 5000, "An existing invoice changed when the quantity did");
 await passed("Adding users does not alter invoices already raised");

 // --- Pausing stops billing ---
 await check(salesClient.rpc("set_subscription_status", { p_subscription: ids.subscription, p_status: "PAUSED", p_reason: "QA: customer paused" }), "Pause");
 const paused = await db.from("customer_subscription").select("status").eq("id", ids.subscription).single();
 assert.equal(paused.data.status, "PAUSED");
 await passed("Sales pauses the agreement");

 // --- The list page shows it all ---
 await page.goto(`${base}/subscriptions?status=ALL`);
 await page.getByRole("heading", { name: "Subscriptions", exact: true }).waitFor();
 const listRow = page.locator("article").filter({ hasText: `QA BabulPOS ${run}` }).first();
 await listRow.waitFor({ timeout: 30000 });
 const rowText = await listRow.innerText();
 assert.ok(rowText.includes("Paused"), `The status is not shown: ${rowText.replace(/\s+/g, " ").slice(0, 120)}`);
 // The change is agreed for next month, so it is pending rather than in force -
 // and the page has to say so, or nobody would know it was recorded.
 assert.ok(rowText.includes("10 users"), "The quantity in force is not shown");
 assert.ok(/Changing to 15/.test(rowText), `The pending change is not shown: ${rowText.replace(/\s+/g, " ").slice(0, 160)}`);
 await page.screenshot({ path: `${output}/subscriptions-list.png`, fullPage: true });
 await passed("The list shows the agreement, its status and the quantity now in force");

 await page.setViewportSize({ width: 390, height: 844 });
 await page.goto(`${base}/subscriptions?status=ALL`);
 await page.getByRole("heading", { name: "Subscriptions", exact: true }).waitFor();
 assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow");
 await passed("The subscriptions page fits a 390px viewport");

 // --- A cancelled agreement is final ---
 await check(salesClient.rpc("set_subscription_status", { p_subscription: ids.subscription, p_status: "CANCELLED", p_reason: "QA: customer left" }), "Cancel");
 const revive = await salesClient.rpc("set_subscription_status", { p_subscription: ids.subscription, p_status: "ACTIVE", p_reason: "QA: bringing it back" });
 assert.ok(revive.error, "A cancelled agreement was reactivated");
 const history = await db.from("subscription_status_change").select("fromStatus,toStatus").eq("subscriptionId", ids.subscription);
 assert.ok(history.data.length >= 3, "The status history is incomplete");
 await passed("A cancelled agreement cannot restart, and its history survives");

 assert.equal(report.browserErrors.length, 0, `Browser runtime errors: ${JSON.stringify(report.browserErrors)}`);
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/subscriptions-failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/subscriptions-failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 const invoiceIds = ((await db.from("invoice").select("id").eq("subscriptionId", ids.subscription)).data ?? []).map(i => i.id);
 if (invoiceIds.length) await clean("Invoice lines", db.from("invoice_line").delete().in("invoiceId", invoiceIds));
 await clean("Invoices", db.from("invoice").delete().eq("subscriptionId", ids.subscription));
 await clean("Quantity changes", db.from("subscription_quantity_change").delete().eq("subscriptionId", ids.subscription));
 await clean("Status history", db.from("subscription_status_change").delete().eq("subscriptionId", ids.subscription));
 await clean("Subscription", db.from("customer_subscription").delete().eq("id", ids.subscription));
 await clean("Product", db.from("product").delete().eq("id", ids.product));
 await clean("Account", db.from("account").delete().eq("id", ids.account));
 for (const role of ["finance", "sales"]) if (ids[role]) {
  await clean(`${role} profile`, db.from("app_user").delete().eq("id", ids[role]));
  await clean(`${role} auth`, db.auth.admin.deleteUser(ids[role]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.salesRole, ids.financeRole]));
 const residue = await db.from("customer_subscription").select("id").eq("id", ids.subscription);
 report.fixtureSubscriptionRemaining = residue.data?.length ?? null;
 const users = await db.from("app_user").select("id").in("id", [ids.sales, ids.finance].filter(Boolean));
 report.fixtureUsersRemaining = users.data?.length ?? null;
 if (report.fixtureSubscriptionRemaining || report.fixtureUsersRemaining) {
  console.error("CLEANUP FAILED: fixtures remain in the database.");
  process.exitCode = 1;
 }
 await writeFile(`${output}/subscriptions-report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureSubscriptionRemaining: report.fixtureSubscriptionRemaining, fixtureUsersRemaining: report.fixtureUsersRemaining }, null, 2));
}
