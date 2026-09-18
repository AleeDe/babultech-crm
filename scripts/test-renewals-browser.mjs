// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Covers the renewal queue and account health.
// Usage: node scripts/test-renewals-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This pilot only targets the local application.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const ids = {
 managerRole: randomUUID(), outsiderRole: randomUUID(), manager: null, outsider: null, formerOwner: null,
 healthyAccount: randomUUID(), troubledAccount: randomUUID(), unownedAccount: randomUUID(),
 healthyContract: randomUUID(), lapsedContract: randomUUID(), farContract: randomUUID(), unownedContract: randomUUID(),
 overdueInvoice: randomUUID(), breachedCase: randomUUID(), activity: randomUUID(), category: null,
};
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/renewal-fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  { id: ids.managerRole, name: `QA ren manager ${run}`, permissions: ["account:read", "account:write", "opportunity:read", "invoice:read", "case:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.outsiderRole, name: `QA ren outsider ${run}`, permissions: ["project:read"], dataScope: "OWN", updatedAt: now() },
 ]), "Create temporary roles");

 const passwords = {}; const emails = {};
 for (const role of ["manager", "outsider"]) {
  passwords[role] = randomBytes(24).toString("base64url");
  emails[role] = `qa-ren-${role}-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({ id: ids[role], fullName: `QA ren ${role}`, email: emails[role], roleId: ids[`${role}Role`], status: "ACTIVE", updatedAt: now() }), "Create temporary profile");
 }
 // Someone who has left: their accounts should read as having nobody named.
 ids.formerOwner = randomUUID();
 await check(db.from("app_user").insert({ id: ids.formerOwner, fullName: `QA ren former ${run}`, email: `qa-ren-former-${run}@example.com`, roleId: ids.managerRole, status: "INACTIVE", updatedAt: now() }), "Create former owner");
 await saveManifest();

 await check(db.from("account").insert([
  { id: ids.healthyAccount, accountNumber: `QAREN-H-${run}`, name: `QA Healthy ${run}`, accountType: "CUSTOMER", customerStatus: "ACTIVE", customerHealth: "GREEN", ownerUserId: ids.manager, updatedAt: now() },
  { id: ids.troubledAccount, accountNumber: `QAREN-T-${run}`, name: `QA Troubled ${run}`, accountType: "CUSTOMER", customerStatus: "ACTIVE", customerHealth: "GREEN", ownerUserId: ids.manager, updatedAt: now() },
  { id: ids.unownedAccount, accountNumber: `QAREN-U-${run}`, name: `QA Unowned ${run}`, accountType: "CUSTOMER", customerStatus: "ONBOARDING", ownerUserId: ids.formerOwner, updatedAt: now() },
 ]), "Create temporary accounts");

 await check(db.from("contract").insert([
  { id: ids.healthyContract, contractNumber: `QAREN-C1-${run}`, name: `QA Ending Soon ${run}`, accountId: ids.healthyAccount, ownerUserId: ids.manager, contractType: "Retainer", status: "ACTIVE", startDate: day(-300), endDate: day(20), contractValue: 12000, currencyCode: "PKR", renewalType: "MANUAL", noticePeriodDays: 30, updatedAt: now() },
  { id: ids.lapsedContract, contractNumber: `QAREN-C2-${run}`, name: `QA Already Ended ${run}`, accountId: ids.troubledAccount, ownerUserId: ids.manager, contractType: "Retainer", status: "ACTIVE", startDate: day(-400), endDate: day(-15), contractValue: 24000, currencyCode: "PKR", renewalType: "AUTO_RENEW", noticePeriodDays: 60, updatedAt: now() },
  { id: ids.farContract, contractNumber: `QAREN-C3-${run}`, name: `QA Far Future ${run}`, accountId: ids.unownedAccount, ownerUserId: ids.manager, contractType: "Retainer", status: "ACTIVE", startDate: day(-30), endDate: day(300), contractValue: 6000, currencyCode: "PKR", renewalType: "MANUAL", noticePeriodDays: 30, updatedAt: now() },
  { id: ids.unownedContract, contractNumber: `QAREN-C4-${run}`, name: `QA Unowned Soon ${run}`, accountId: ids.unownedAccount, ownerUserId: ids.manager, contractType: "Retainer", status: "ACTIVE", startDate: day(-200), endDate: day(45), contractValue: 9000, currencyCode: "PKR", renewalType: "MANUAL", noticePeriodDays: 30, updatedAt: now() },
 ]), "Create temporary contracts");

 // An overdue invoice and a breached case, so the troubled account has something real to score on.
 await check(db.from("invoice").insert({
  id: ids.overdueInvoice, invoiceNumber: `QAREN-INV-${run}`, accountId: ids.troubledAccount,
  invoiceDate: day(-120), dueDate: day(-95), status: "SENT", currencyCode: "PKR",
  subtotal: 5000, discountAmount: 0, taxAmount: 0, totalAmount: 5000, paidAmount: 0, outstandingAmount: 5000, updatedAt: now(),
 }), "Create overdue invoice");

 await check(db.from("support_case").insert({
  id: ids.breachedCase, caseNumber: `QAREN-CASE-${run}`, subject: "QA breached case", description: "QA synthetic case",
  accountId: ids.troubledAccount, ownerUserId: ids.manager, status: "IN_PROGRESS", priority: "HIGH", slaBreached: true, reopenCount: 1, updatedAt: now(),
 }), "Create breached case");

 // Recent contact on the healthy account only.
 await check(db.from("activity").insert({
  id: ids.activity, activityType: "CALL", subject: "QA check-in", ownerUserId: ids.manager,
  relatedEntityType: "Account", relatedEntityId: ids.healthyAccount, completedAt: now(), status: "COMPLETED", updatedAt: now(),
 }), "Create recent activity");

 browser = await chromium.launch({ headless: true });
 const contexts = {}; const pages = {};
 for (const role of ["manager", "outsider"]) {
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
 const manager = pages.manager, outsider = pages.outsider;

 // --- Renewal queue ---
 currentPage = manager;
 await manager.goto(`${base}/accounts/renewals?window=90`);
 await manager.getByRole("heading", { name: "Renewals", exact: true }).waitFor();
 await manager.getByText(`QA Ending Soon ${run}`, { exact: false }).waitFor();
 await manager.screenshot({ path: `${output}/renewals-queue.png`, fullPage: true });
 await passed("Renewal queue lists a contract ending inside the window");

 assert.equal(await manager.getByText(`QA Far Future ${run}`, { exact: false }).count(), 0);
 await passed("A contract beyond the window is left out");

 await manager.getByText(`QA Already Ended ${run}`, { exact: false }).waitFor();
 await passed("A contract that already ended still appears");

 // The lapsed one must come first: it needs attention before one ending later.
 const order = await manager.locator("article").allInnerTexts();
 assert.ok(order[0].includes("QA Already Ended"), `Lapsed contract is not first: ${order[0]?.slice(0, 60)}`);
 assert.ok(order[0].includes("days ago"), "The lapsed row does not say how long ago it ended");
 await passed("The lapsed contract is listed first, with how long ago it ended");

 // The 30-day window must drop the one ending in 20 days? No - it is inside 30.
 await manager.goto(`${base}/accounts/renewals?window=30`);
 await manager.getByText(`QA Ending Soon ${run}`, { exact: false }).waitFor();
 await manager.getByText(`QA Already Ended ${run}`, { exact: false }).waitFor();
 await passed("A narrower window keeps what is inside it and the lapsed contract");

 // An unoffered window falls back to 90 rather than showing everything.
 await manager.goto(`${base}/accounts/renewals?window=365`);
 assert.equal(await manager.getByText(`QA Far Future ${run}`, { exact: false }).count(), 0);
 await passed("An unrecognised window falls back to the default rather than widening it");

 // Named account manager, and the gap where there is none. The unowned account
 // has a contract inside the window for exactly this check.
 await manager.goto(`${base}/accounts/renewals?window=90`);
 const unownedRow = manager.locator("article").filter({ hasText: `QA Unowned Soon ${run}` });
 await unownedRow.getByText("Nobody named", { exact: false }).waitFor();
 await passed("A contract whose account owner has left reads as nobody named");

 const soonRow = manager.locator("article").filter({ hasText: `QA Ending Soon ${run}` });
 await soonRow.getByText(`QA ren manager`, { exact: false }).waitFor();
 await passed("An active account manager is named on the row");

 // --- Account health ---
 await manager.goto(`${base}/accounts/health?show=all`);
 await manager.getByRole("heading", { name: "Account health", exact: true }).waitFor();
 const troubled = manager.locator("article").filter({ hasText: `QA Troubled ${run}` });
 await troubled.getByText("Overdue invoices", { exact: false }).waitFor();
 await troubled.getByText("Missed support commitments", { exact: false }).waitFor();
 await manager.screenshot({ path: `${output}/renewals-health.png`, fullPage: true });
 await passed("Health explains each signal it counted, rather than showing a bare score");

 // Derived health must not have overwritten the stored field.
 const stored = await db.from("account").select("customerHealth").eq("id", ids.troubledAccount).single();
 assert.equal(stored.data.customerHealth, "GREEN", "The stored health field was overwritten");
 await troubled.getByText("stored:", { exact: false }).waitFor();
 await passed("The stored health is left alone and the disagreement is shown");

 // This account's own contract ends in 20 days, so it carries that one mild
 // signal and still reads GREEN - a renewal coming up is not a problem.
 const healthy = manager.locator("article").filter({ hasText: `QA Healthy ${run}` });
 await healthy.getByText("Renewal approaching", { exact: false }).waitFor();
 await healthy.getByText("GREEN", { exact: false }).waitFor();
 assert.equal(await healthy.getByText("Overdue invoices", { exact: false }).count(), 0);
 await passed("A mild signal alone does not drag an account out of green");

 // Filters.
 await manager.goto(`${base}/accounts/health?show=unowned`);
 await manager.getByText(`QA Unowned ${run}`, { exact: false }).waitFor();
 assert.equal(await manager.getByText(`QA Healthy ${run}`, { exact: false }).count(), 0);
 await passed("The unowned filter shows only accounts with nobody answerable");

 await manager.goto(`${base}/accounts/health?show=onboarding`);
 await manager.getByText(`QA Unowned ${run}`, { exact: false }).waitFor();
 await passed("The onboarding filter finds a customer still being onboarded");

 await manager.goto(`${base}/accounts/health?show=attention`);
 await manager.getByText(`QA Troubled ${run}`, { exact: false }).waitFor();
 assert.equal(await manager.getByText(`QA Healthy ${run}`, { exact: false }).count(), 0);
 await passed("The attention filter leaves out accounts with nothing flagging");

 // --- Someone without the permissions sees neither page ---
 currentPage = outsider;
 await outsider.goto(`${base}/accounts/health`);
 assert.equal(await outsider.getByText(`QA Troubled ${run}`, { exact: false }).count(), 0);
 await passed("Someone without account access sees no customer health data");

 await outsider.goto(`${base}/accounts/renewals`);
 assert.equal(await outsider.getByText(`QA Ending Soon ${run}`, { exact: false }).count(), 0);
 await passed("Someone without contract access sees no renewals");

 currentPage = manager;
 await manager.setViewportSize({ width: 390, height: 844 });
 await manager.goto(`${base}/accounts/renewals?window=90`);
 await manager.getByRole("heading", { name: "Renewals", exact: true }).waitFor();
 assert.equal(await manager.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow on renewals");
 await manager.goto(`${base}/accounts/health`);
 await manager.getByRole("heading", { name: "Account health", exact: true }).waitFor();
 assert.equal(await manager.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow on health");
 await passed("Both pages fit a 390px viewport");

 assert.equal(report.browserErrors.length, 0, `Browser runtime errors: ${JSON.stringify(report.browserErrors)}`);
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/renewals-failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/renewals-failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 // Delete only this run's explicitly named fixture IDs, child rows first.
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 const accountIds = [ids.healthyAccount, ids.troubledAccount, ids.unownedAccount];
 await clean("Activity", db.from("activity").delete().eq("id", ids.activity));
 await clean("Support case", db.from("support_case").delete().eq("id", ids.breachedCase));
 await clean("Invoice lines", db.from("invoice_line").delete().eq("invoiceId", ids.overdueInvoice));
 await clean("Invoice", db.from("invoice").delete().eq("id", ids.overdueInvoice));
 await clean("Contracts", db.from("contract").delete().in("id", [ids.healthyContract, ids.lapsedContract, ids.farContract, ids.unownedContract]));
 await clean("Accounts", db.from("account").delete().in("id", accountIds));
 for (const key of ["outsider", "manager", "formerOwner"]) if (ids[key]) {
  await clean(`${key} profile`, db.from("app_user").delete().eq("id", ids[key]));
  if (key !== "formerOwner") await clean(`${key} auth`, db.auth.admin.deleteUser(ids[key]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.managerRole, ids.outsiderRole]));
 const residue = await db.from("account").select("id").in("id", accountIds);
 report.fixtureAccountsRemaining = residue.data?.length ?? null;
 await writeFile(`${output}/renewals-report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureAccountsRemaining: report.fixtureAccountsRemaining }, null, 2));
}
