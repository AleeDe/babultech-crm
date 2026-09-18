// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Covers the finance write boundaries: who may draft, who may issue, and that
// the ledger stops being editable once an invoice is out.
// Usage: node scripts/test-finance-browser.mjs http://localhost:3100
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
const ids = { selfInvoice: null, preparerRole: randomUUID(), approverRole: randomUUID(), contributorRole: randomUUID(), preparer: null, approver: null, contributor: null, account: randomUUID(), invoice: null };
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/finance-fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
// A client carrying one synthetic user's own token, to prove the database
// refuses what the server actions refuse.
async function asUser(email, password) {
 const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
 const signIn = await client.auth.signInWithPassword({ email, password });
 if (signIn.error) throw new Error(`Token sign-in failed: ${signIn.error.code ?? signIn.error.message}`);
 return client;
}
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  { id: ids.preparerRole, name: `QA fin preparer ${run}`, permissions: ["invoice:read", "invoice:write", "payment:write", "account:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.approverRole, name: `QA fin approver ${run}`, permissions: ["invoice:read", "invoice:write", "invoice:approve", "payment:write", "account:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.contributorRole, name: `QA fin contributor ${run}`, permissions: ["project:read", "expense:write"], dataScope: "ALL", updatedAt: now() },
 ]), "Create temporary roles");
 const passwords = {}; const emails = {};
 for (const role of ["preparer", "approver", "contributor"]) {
  passwords[role] = randomBytes(24).toString("base64url");
  emails[role] = `qa-fin-${role}-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({ id: ids[role], fullName: `QA fin ${role}`, email: emails[role], roleId: ids[`${role}Role`], status: "ACTIVE", updatedAt: now() }), "Create temporary profile");
 }
 await check(db.from("account").insert({ id: ids.account, accountNumber: `QAFIN-${run}`, name: `QA Finance Account ${run}`, ownerUserId: ids.approver, updatedAt: now() }), "Create temporary account");

 browser = await chromium.launch({ headless: true });
 const contexts = {}; const pages = {};
 for (const role of ["preparer", "approver"]) {
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
 const preparer = pages.preparer, approver = pages.approver;

 // --- The finance screens still work for the people who should have them ---
 currentPage = preparer;
 await preparer.goto(`${base}/invoices/new`);
 await preparer.getByRole("heading", { name: "New invoice", exact: false }).waitFor();
 await passed("Preparer can still open the new invoice screen");

 // Draft through the application, the way a finance operator actually would.
 const preparerClient = await asUser(emails.preparer, passwords.preparer);
 const drafted = await preparerClient.from("invoice").insert({
  invoiceNumber: `QAFIN-D-${run}`, accountId: ids.account, invoiceDate: day(0), dueDate: day(30),
  status: "DRAFT", currencyCode: "PKR", subtotal: 1000, discountAmount: 0, taxAmount: 0,
  totalAmount: 1000, paidAmount: 0, outstandingAmount: 1000, updatedAt: now(),
 }).select("id,preparedById").single();
 assert.equal(drafted.error, null, `Preparer should be able to draft: ${drafted.error?.message}`);
 ids.invoice = drafted.data.id; await saveManifest();
 assert.equal(drafted.data.preparedById, ids.preparer, "The preparer should be stamped automatically");
 await passed("Preparer drafts an invoice and is recorded as its preparer");

 const line = await preparerClient.from("invoice_line").insert({
  invoiceId: ids.invoice, description: "QA finance line", quantity: 1, unitPrice: 1000, lineTotal: 1000, updatedAt: now(),
 }).select("id").single();
 assert.equal(line.error, null, `Preparer should be able to add lines: ${line.error?.message}`);
 await passed("Preparer adds a line to their draft");

 // --- A contributor cannot touch the ledger, whatever route they take ---
 const contributorClient = await asUser(emails.contributor, passwords.contributor);
 const contributorInvoice = await contributorClient.from("invoice").insert({
  invoiceNumber: `QAFIN-C-${run}`, accountId: ids.account, invoiceDate: day(0), dueDate: day(30),
  status: "DRAFT", currencyCode: "PKR", subtotal: 1, discountAmount: 0, taxAmount: 0,
  totalAmount: 1, paidAmount: 0, outstandingAmount: 1, updatedAt: now(),
 });
 assert.ok(contributorInvoice.error, "A contributor with no invoice grant raised an invoice");
 await passed("Contributor cannot raise an invoice through the database");

 const contributorIssue = await contributorClient.from("invoice").update({ status: "SENT", updatedAt: now() }).eq("id", ids.invoice).select("id");
 assert.equal((contributorIssue.data ?? []).length, 0, "A contributor issued an invoice");
 const afterContributor = await db.from("invoice").select("status").eq("id", ids.invoice).single();
 assert.equal(afterContributor.data.status, "DRAFT", "A contributor moved an invoice out of draft");
 await passed("Contributor cannot issue an existing invoice");

 const contributorPayment = await contributorClient.from("payment").insert({
  paymentNumber: `QAFIN-P-${run}`, accountId: ids.account, paymentDate: day(0), amount: 1000,
  currencyCode: "PKR", paymentMethod: "BANK", updatedAt: now(),
 });
 assert.ok(contributorPayment.error, "A contributor recorded a payment");
 await passed("Contributor cannot record a payment");

 // --- The preparer cannot issue, through the UI or around it ---
 const preparerIssue = await preparerClient.from("invoice").update({ status: "SENT", updatedAt: now() }).eq("id", ids.invoice).select("id");
 const stillDraft = await db.from("invoice").select("status").eq("id", ids.invoice).single();
 assert.equal(stillDraft.data.status, "DRAFT", "The preparer issued their own invoice through the database");
 assert.ok(preparerIssue.error || (preparerIssue.data ?? []).length === 0, "The preparer's issue attempt was not refused");
 await passed("Preparer cannot issue their own invoice through the database");

 // The dangerous case is someone who holds invoice:approve AND prepared the
 // invoice - permission alone would let them through, so the separation rule
 // is the only thing standing there. The approver raises their own draft.
 const approverClient = await asUser(emails.approver, passwords.approver);
 const ownDraft = await approverClient.from("invoice").insert({
  invoiceNumber: `QAFIN-S-${run}`, accountId: ids.account, invoiceDate: day(0), dueDate: day(30),
  status: "DRAFT", currencyCode: "PKR", subtotal: 500, discountAmount: 0, taxAmount: 0,
  totalAmount: 500, paidAmount: 0, outstandingAmount: 500, updatedAt: now(),
 }).select("id,preparedById").single();
 assert.equal(ownDraft.error, null, `Approver should be able to draft: ${ownDraft.error?.message}`);
 ids.selfInvoice = ownDraft.data.id; await saveManifest();
 assert.equal(ownDraft.data.preparedById, ids.approver);
 await check(approverClient.from("invoice_line").insert({
  invoiceId: ids.selfInvoice, description: "QA self line", quantity: 1, unitPrice: 500, lineTotal: 500, updatedAt: now(),
 }), "Add a line to the approver's own draft");

 const selfIssue = await approverClient.from("invoice").update({ status: "SENT", updatedAt: now() }).eq("id", ids.selfInvoice).select("id");
 const selfStillDraft = await db.from("invoice").select("status").eq("id", ids.selfInvoice).single();
 assert.equal(selfStillDraft.data.status, "DRAFT", "Someone with invoice:approve issued the invoice they prepared");
 assert.ok(selfIssue.error, "The self-issue attempt was not refused");
 await passed("Holding invoice:approve is not enough to issue your own invoice");

 currentPage = approver;
 await approver.goto(`${base}/invoices/${ids.selfInvoice}`);
 await approver.getByRole("button", { name: "Issue invoice", exact: true }).click();
 await approver.getByText("prepared by you", { exact: false }).waitFor({ timeout: 30000 });
 await approver.screenshot({ path: `${output}/finance-self-issue-refused.png`, fullPage: true });
 const afterUiAttempt = await db.from("invoice").select("status").eq("id", ids.selfInvoice).single();
 assert.equal(afterUiAttempt.data.status, "DRAFT");
 await passed("The invoice screen explains why you cannot issue what you prepared");

 // --- A second person issues it ---
 currentPage = approver;
 await approver.goto(`${base}/invoices/${ids.invoice}`);
 await approver.getByRole("button", { name: "Issue invoice", exact: true }).click();
 // The button reads "Working…" until the action settles; wait for the result
 // rather than reading the database mid-flight.
 await approver.getByRole("button", { name: "Working…", exact: true }).waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
 await approver.getByText("Issued and no longer editable", { exact: false }).waitFor({ timeout: 30000 });
 await approver.screenshot({ path: `${output}/finance-issued.png`, fullPage: true });
 const issued = await db.from("invoice").select("status,issuedById").eq("id", ids.invoice).single();
 assert.equal(issued.data.status, "SENT");
 assert.equal(issued.data.issuedById, ids.approver, "The issuer was not recorded");
 await passed("A second person issues the invoice and is recorded as the issuer");

 // --- Once issued, the figures are the ledger ---
 const editIssued = await preparerClient.from("invoice_line").update({ unitPrice: 9999, lineTotal: 9999, updatedAt: now() }).eq("id", line.data.id).select("id");
 assert.equal((editIssued.data ?? []).length, 0, "A line of an issued invoice was edited");
 const lineAfter = await db.from("invoice_line").select("unitPrice").eq("id", line.data.id).single();
 assert.equal(Number(lineAfter.data.unitPrice), 1000, "The issued invoice's line amount changed");
 await passed("Lines of an issued invoice can no longer be edited");

 const deleteIssued = await preparerClient.from("invoice").delete().eq("id", ids.invoice).select("id");
 assert.equal((deleteIssued.data ?? []).length, 0, "An issued invoice was deleted");
 assert.ok((await db.from("invoice").select("id").eq("id", ids.invoice)).data.length === 1);
 await passed("An issued invoice cannot be deleted");

 // --- Recording a receipt still works for finance ---
 const payment = await approverClient.from("payment").insert({
  paymentNumber: `QAFIN-PAY-${run}`, accountId: ids.account, paymentDate: day(0), amount: 400,
  currencyCode: "PKR", paymentMethod: "BANK", updatedAt: now(),
 }).select("id").single();
 assert.equal(payment.error, null, `Finance should still be able to record a receipt: ${payment.error?.message}`);
 ids.payment = payment.data.id; await saveManifest();
 await passed("Finance can still record a payment");

 // --- The invoice list still renders for both ---
 currentPage = approver;
 await approver.goto(`${base}/invoices`);
 await approver.getByText(`QAFIN-D-${run}`, { exact: false }).first().waitFor();
 await passed("The invoice list still renders after the policy change");

 await approver.setViewportSize({ width: 390, height: 844 });
 await approver.goto(`${base}/invoices/${ids.invoice}`);
 await approver.getByRole("button", { name: "Issue invoice", exact: true }).waitFor({ state: "detached" }).catch(() => {});
 assert.equal(await approver.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow");
 await passed("Invoice page fits 390px viewport");

 assert.equal(report.browserErrors.length, 0, `Browser runtime errors: ${JSON.stringify(report.browserErrors)}`);
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/finance-failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/finance-failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 // Delete only this run's explicitly named fixture IDs, child rows first.
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 if (ids.payment) await clean("Payment allocations", db.from("payment_allocation").delete().eq("paymentId", ids.payment));
 await clean("Payments", db.from("payment").delete().eq("accountId", ids.account));
 if (ids.invoice) await clean("Invoice lines", db.from("invoice_line").delete().eq("invoiceId", ids.invoice));
 await clean("Invoices", db.from("invoice").delete().eq("accountId", ids.account));
 await clean("Account", db.from("account").delete().eq("id", ids.account));
 for (const role of ["contributor", "approver", "preparer"]) if (ids[role]) {
  await clean(`${role} profile`, db.from("app_user").delete().eq("id", ids[role]));
  await clean(`${role} auth`, db.auth.admin.deleteUser(ids[role]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.preparerRole, ids.approverRole, ids.contributorRole]));
 const residue = await db.from("account").select("id").eq("id", ids.account);
 report.fixtureAccountRemaining = residue.data?.length ?? null;
 await writeFile(`${output}/finance-report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureAccountRemaining: report.fixtureAccountRemaining }, null, 2));
}
