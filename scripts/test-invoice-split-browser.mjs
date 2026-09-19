// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Covers the invoice:approve split: narrow grants work on their own, and the
// coarse grant still does everything it did before.
// Usage: node scripts/test-invoice-split-browser.mjs http://localhost:3100
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
 legacyRole: randomUUID(), issuerRole: randomUUID(), voiderRole: randomUUID(), closerRole: randomUUID(), drafterRole: randomUUID(),
 legacy: null, issuer: null, voider: null, closer: null, drafter: null,
 account: randomUUID(), invIssue: randomUUID(), invVoid: randomUUID(), invLegacy: randomUUID(),
};
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/split-fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
async function asUser(email, password) {
 const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
 const signIn = await client.auth.signInWithPassword({ email, password });
 if (signIn.error) throw new Error(`Token sign-in failed: ${signIn.error.code ?? signIn.error.message}`);
 return client;
}
const draft = (id, number) => ({
 id, invoiceNumber: number, accountId: ids.account, invoiceDate: day(0), dueDate: day(30),
 status: "DRAFT", currencyCode: "PKR", subtotal: 1000, discountAmount: 0, taxAmount: 0,
 totalAmount: 1000, paidAmount: 0, outstandingAmount: 1000, updatedAt: now(),
});
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  // The role as it was before the split.
  { id: ids.legacyRole, name: `QA split legacy ${run}`, permissions: ["invoice:read", "invoice:write", "invoice:approve", "payment:write", "account:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.issuerRole, name: `QA split issuer ${run}`, permissions: ["invoice:read", "invoice:write", "invoice:issue", "payment:write", "account:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.voiderRole, name: `QA split voider ${run}`, permissions: ["invoice:read", "invoice:write", "invoice:void", "payment:write", "account:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.closerRole, name: `QA split closer ${run}`, permissions: ["invoice:read", "period:close", "account:read"], dataScope: "ALL", updatedAt: now() },
  { id: ids.drafterRole, name: `QA split drafter ${run}`, permissions: ["invoice:read", "invoice:write", "payment:write", "account:read"], dataScope: "ALL", updatedAt: now() },
 ]), "Create temporary roles");

 const passwords = {}; const emails = {};
 for (const role of ["legacy", "issuer", "voider", "closer", "drafter"]) {
  passwords[role] = randomBytes(24).toString("base64url");
  emails[role] = `qa-split-${role}-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({ id: ids[role], fullName: `QA split ${role}`, email: emails[role], roleId: ids[`${role}Role`], status: "ACTIVE", updatedAt: now() }), "Create temporary profile");
 }

 await check(db.from("account").insert({ id: ids.account, accountNumber: `QASPL-${run}`, name: `QA Split Account ${run}`, ownerUserId: ids.legacy, updatedAt: now() }), "Create temporary account");

 // The drafter prepares every invoice, so the separation-of-duties rule never
 // interferes with what is being tested here.
 const drafterClient = await asUser(emails.drafter, passwords.drafter);
 for (const [id, number] of [[ids.invIssue, `QASPL-I-${run}`], [ids.invVoid, `QASPL-V-${run}`], [ids.invLegacy, `QASPL-L-${run}`]]) {
  const made = await drafterClient.from("invoice").insert(draft(id, number)).select("id").single();
  assert.equal(made.error, null, `Drafter could not prepare an invoice: ${made.error?.message}`);
  await check(db.from("invoice_line").insert({ invoiceId: id, description: "QA split line", quantity: 1, unitPrice: 1000, lineTotal: 1000, updatedAt: now() }), "Add a line");
 }
 await passed("A drafter with only invoice:write can still prepare invoices");

 // --- A narrow issuer issues, and nothing else ---
 const issuerClient = await asUser(emails.issuer, passwords.issuer);
 const issued = await issuerClient.from("invoice").update({ status: "SENT", sentAt: now(), updatedAt: now() }).eq("id", ids.invIssue).select("id");
 assert.equal(issued.error, null, `A narrow issuer could not issue: ${issued.error?.message}`);
 assert.equal((await db.from("invoice").select("status").eq("id", ids.invIssue).single()).data.status, "SENT");
 await passed("invoice:issue on its own can issue an invoice");

 const issuerVoid = await issuerClient.from("invoice").update({ status: "WRITTEN_OFF", updatedAt: now() }).eq("id", ids.invVoid).select("id");
 assert.notEqual((await db.from("invoice").select("status").eq("id", ids.invVoid).single()).data.status, "WRITTEN_OFF",
  "A narrow issuer wrote off an invoice");
 assert.ok(issuerVoid.error || (issuerVoid.data ?? []).length === 0);
 await passed("invoice:issue cannot write off an invoice");

 const issuerClose = await issuerClient.rpc("close_accounting_period", { p_period: day(-60).slice(0, 8) + "01", p_note: "QA issuer attempt" });
 assert.ok(issuerClose.error, "A narrow issuer closed an accounting period");
 await passed("invoice:issue cannot close an accounting period");

 // --- A narrow voider voids, and cannot issue ---
 const voiderClient = await asUser(emails.voider, passwords.voider);
 const voided = await voiderClient.from("invoice").update({ status: "CANCELLED", updatedAt: now() }).eq("id", ids.invVoid).select("id");
 assert.equal(voided.error, null, `A narrow voider could not cancel: ${voided.error?.message}`);
 assert.equal((await db.from("invoice").select("status").eq("id", ids.invVoid).single()).data.status, "CANCELLED");
 await passed("invoice:void on its own can cancel an invoice");

 const voiderIssue = await voiderClient.from("invoice").update({ status: "SENT", updatedAt: now() }).eq("id", ids.invLegacy).select("id");
 assert.notEqual((await db.from("invoice").select("status").eq("id", ids.invLegacy).single()).data.status, "SENT",
  "A narrow voider issued an invoice");
 assert.ok(voiderIssue.error || (voiderIssue.data ?? []).length === 0);
 await passed("invoice:void cannot issue an invoice");

 // --- The coarse grant still does everything ---
 const legacyClient = await asUser(emails.legacy, passwords.legacy);
 const legacyIssued = await legacyClient.from("invoice").update({ status: "SENT", sentAt: now(), updatedAt: now() }).eq("id", ids.invLegacy).select("id");
 assert.equal(legacyIssued.error, null, `invoice:approve lost the ability to issue: ${legacyIssued.error?.message}`);
 assert.equal((await db.from("invoice").select("status").eq("id", ids.invLegacy).single()).data.status, "SENT");
 await passed("invoice:approve still issues, exactly as before");

 const legacyVoided = await legacyClient.from("invoice").update({ status: "WRITTEN_OFF", updatedAt: now() }).eq("id", ids.invLegacy).select("id");
 assert.equal(legacyVoided.error, null, `invoice:approve lost the ability to void: ${legacyVoided.error?.message}`);
 await passed("invoice:approve still writes off, exactly as before");

 // --- The UI follows the same split ---
 browser = await chromium.launch({ headless: true });
 const pages = {};
 for (const role of ["closer", "drafter", "legacy"]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  pages[role] = await context.newPage();
  const page = pages[role]; currentPage = page;
  page.on("pageerror", error => report.browserErrors.push({ role, message: error.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(emails[role]);
  await page.locator('input[name="password"]').fill(passwords[role]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 30000 });
 }
 await passed("Narrow-grant users sign in");

 // A period closer sees the close form.
 currentPage = pages.closer;
 await pages.closer.goto(`${base}/finance/periods`);
 await pages.closer.getByRole("heading", { name: "Accounting periods", exact: true }).waitFor();
 await pages.closer.getByText("Close a month", { exact: true }).waitFor();
 await pages.closer.screenshot({ path: `${output}/split-closer.png`, fullPage: true });
 await passed("period:close on its own opens the period-closing screen");

 // A drafter sees the page but cannot close anything.
 currentPage = pages.drafter;
 await pages.drafter.goto(`${base}/finance/periods`);
 await pages.drafter.getByText("needs period-closing authority", { exact: false }).waitFor();
 assert.equal(await pages.drafter.getByRole("button", { name: "Close month", exact: true }).count(), 0);
 await passed("Someone without period:close is told so, and gets no close button");

 // The legacy role still sees everything it used to.
 currentPage = pages.legacy;
 await pages.legacy.goto(`${base}/finance/periods`);
 await pages.legacy.getByText("Close a month", { exact: true }).waitFor();
 await passed("invoice:approve still reaches the period screen");

 await pages.legacy.goto(`${base}/invoices/${ids.invIssue}`);
 await pages.legacy.getByRole("heading", { name: `QASPL-I-${run}`, exact: false }).waitFor();
 await passed("invoice:approve still reaches an issued invoice");

 await pages.closer.setViewportSize({ width: 390, height: 844 });
 await pages.closer.goto(`${base}/finance/periods`);
 await pages.closer.getByRole("heading", { name: "Accounting periods", exact: true }).waitFor();
 assert.equal(await pages.closer.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow");
 await passed("The period screen fits a 390px viewport for a narrow-grant user");

 assert.equal(report.browserErrors.length, 0, `Browser runtime errors: ${JSON.stringify(report.browserErrors)}`);
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/split-failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/split-failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 // Delete only this run's explicitly named fixture IDs, child rows first.
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 const invoiceIds = [ids.invIssue, ids.invVoid, ids.invLegacy];
 await clean("Invoice lines", db.from("invoice_line").delete().in("invoiceId", invoiceIds));
 await clean("Invoices", db.from("invoice").delete().in("id", invoiceIds));
 await clean("Account", db.from("account").delete().eq("id", ids.account));
 for (const role of ["drafter", "closer", "voider", "issuer", "legacy"]) if (ids[role]) {
  await clean(`${role} profile`, db.from("app_user").delete().eq("id", ids[role]));
  await clean(`${role} auth`, db.auth.admin.deleteUser(ids[role]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.legacyRole, ids.issuerRole, ids.voiderRole, ids.closerRole, ids.drafterRole]));
 const residue = await db.from("account").select("id").eq("id", ids.account);
 report.fixtureAccountRemaining = residue.data?.length ?? null;
 await writeFile(`${output}/split-report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureAccountRemaining: report.fixtureAccountRemaining }, null, 2));
}
