// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Covers Phase 2: calling queue and qualification / sales handoff.
// Usage: node scripts/test-leads-browser.mjs http://localhost:3100
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
const ids = { sdrRole: randomUUID(), salesRole: randomUUID(), sdr: null, sales: null, lead: randomUUID() };
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
// datetime-local value in Pakistan time, days ahead of now.
const pkInput = (days) => new Date(Date.now() + days * 86400000 + 5 * 3600000).toISOString().slice(0, 16);
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/lead-fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  { id: ids.sdrRole, name: `QA sdr ${run}`, permissions: ["lead:read", "lead:write", "activity:read", "activity:write"], dataScope: "OWN", updatedAt: now() },
  { id: ids.salesRole, name: `QA sales ${run}`, permissions: ["lead:read", "lead:write", "opportunity:write", "activity:read", "activity:write"], dataScope: "OWN", updatedAt: now() },
 ]), "Create temporary roles");
 const passwords = { sdr: randomBytes(24).toString("base64url"), sales: randomBytes(24).toString("base64url") };
 const emails = { sdr: `qa-sdr-${run}@example.com`, sales: `qa-sales-${run}@example.com` };
 for (const role of ["sdr", "sales"]) {
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({ id: ids[role], fullName: `QA ${role}`, email: emails[role], roleId: ids[`${role}Role`], status: "ACTIVE", updatedAt: now() }), "Create temporary profile");
 }
 await check(db.from("lead").insert({ id: ids.lead, leadNumber: `QA-L-${run}`, firstName: "QA", lastName: `Prospect ${run}`, companyName: "QA Test Company", phone: "+920000000000", email: `qa-lead-${run}@example.com`, status: "NEW", ownerUserId: ids.sdr, updatedAt: now() }), "Create temporary lead");
 browser = await chromium.launch({ headless: true });
 const contexts = { sdr: await browser.newContext({ viewport: { width: 1440, height: 1000 } }), sales: await browser.newContext({ viewport: { width: 1440, height: 1000 } }) };
 const pages = { sdr: await contexts.sdr.newPage(), sales: await contexts.sales.newPage() };
 for (const role of ["sdr", "sales"]) {
  const page = pages[role]; currentPage = page;
  page.on("pageerror", error => report.browserErrors.push({ role, message: error.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(emails[role]);
  await page.locator('input[name="password"]').fill(passwords[role]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 30000 });
  await passed(`${role} UI login`);
 }
 const sdr = pages.sdr, sales = pages.sales;

 // --- Calling queue ---
 currentPage = sdr;
 await sdr.goto(`${base}/leads/calling?filter=unscheduled`);
 await sdr.getByRole("heading", { name: "My calling queue", exact: true }).waitFor();
 await sdr.getByText(`QA Prospect ${run}`, { exact: false }).first().waitFor();
 await passed("Unscheduled lead appears in SDR calling queue");

 // A lead assigned to someone else must not leak into this queue.
 currentPage = sales;
 await sales.goto(`${base}/leads/calling?filter=all`);
 assert.equal(await sales.getByText(`QA Prospect ${run}`, { exact: false }).count(), 0);
 await passed("Calling queue is personal; unassigned salesperson sees no other owner's lead");

 currentPage = sdr;
 await sdr.getByText("Log completed call", { exact: true }).first().click();
 await sdr.locator('select[name="outcome"]').selectOption({ index: 0 });
 await sdr.locator('input[name="followUpAt"]').fill(pkInput(2));
 await sdr.locator('textarea[name="notes"]').fill("QA synthetic call: discussed requirements, agreed to follow up. No real call placed.");
 await sdr.getByRole("button", { name: "Save call & follow-up", exact: true }).click();
 await sdr.getByRole("status").waitFor();
 await sdr.screenshot({ path: `${output}/calling-queue.png`, fullPage: true });
 await passed("SDR logs a completed call and schedules the next follow-up");

 const activity = await db.from("activity").select("id,subject").eq("relatedEntityId", ids.lead);
 assert.ok((activity.data ?? []).length >= 1, "Call was not written to the activity ledger");
 const leadAfterCall = await db.from("lead").select("status,nextFollowUpAt,ownerUserId").eq("id", ids.lead).single();
 assert.ok(leadAfterCall.data.nextFollowUpAt, "Follow-up was not recorded on the lead");
 assert.equal(leadAfterCall.data.status, "NEW", "Logging a call must not change lifecycle status");
 await passed("Call writes the activity ledger and follow-up without changing lead status");

 // --- Qualification and sales handoff ---
 await sdr.goto(`${base}/leads/${ids.lead}`);
 await sdr.getByText("Qualification & sales handoff", { exact: true }).waitFor();
 for (const [field, value] of [
  ["serviceInterest", "QA: point-of-sale rollout"],
  ["need", "QA: replacing manual stock counting"],
  ["authority", "Unknown — needs checking with the owner"],
  ["budget", "Unknown — to be confirmed after the demo"],
  ["timing", "QA: targeting next quarter"],
  ["nextAction", "QA: product demo with the shop owner"],
 ]) await sdr.locator(`textarea[name="${field}"]`).fill(value);
 await sdr.locator('select[name="recipientId"]').selectOption({ label: "QA sales" });
 await sdr.locator('input[name="followUpAt"]').fill(pkInput(3));
 await sdr.getByRole("button", { name: "Submit sales handoff", exact: true }).click();
 await sdr.getByRole("status").waitFor();
 await passed("SDR submits qualification and sales handoff");

 const qualified = await db.from("lead").select("status,ownerUserId").eq("id", ids.lead).single();
 assert.equal(qualified.data.status, "QUALIFIED", "Submission should mark the lead Qualified");
 assert.equal(qualified.data.ownerUserId, ids.sdr, "Ownership must stay with the sender until acceptance");
 await passed("Submission qualifies the lead but retains sender ownership");

 // Pending handoff blocks the sender from re-submitting.
 await sdr.reload();
 await sdr.getByText("A sales handoff is pending.", { exact: false }).waitFor();
 await passed("Pending handoff blocks a second submission and links to review");

 // Recipient reviews and accepts.
 currentPage = sales;
 await sales.goto(`${base}/leads/handoffs`);
 await sales.getByRole("heading", { name: "Sales handoffs", exact: true }).waitFor();
 await sales.getByText("QA: replacing manual stock counting", { exact: true }).waitFor();
 await sales.screenshot({ path: `${output}/lead-handoff.png`, fullPage: true });
 await passed("Recipient sees the qualification brief");

 await sales.locator("select").first().selectOption("ACCEPTED");
 await sales.locator('input[name="followUpAt"]').fill(pkInput(4));
 await sales.locator('textarea[name="reason"]').fill("QA: accepted, booking the demo.");
 await sales.getByRole("button", { name: "Record decision", exact: true }).click();
 await sales.getByRole("link", { name: "Open lead and continue to conversion", exact: true }).waitFor();
 await passed("Recipient accepts the handoff through the UI");

 const accepted = await db.from("lead").select("ownerUserId").eq("id", ids.lead).single();
 assert.equal(accepted.data.ownerUserId, ids.sales, "Acceptance must transfer ownership to the recipient");
 await passed("Acceptance atomically transfers lead ownership");

 // The lead should now be in the new owner's calling queue, and gone from the sender's.
 await sales.goto(`${base}/leads/calling?filter=all`);
 await sales.getByText(`QA Prospect ${run}`, { exact: false }).first().waitFor();
 currentPage = sdr;
 await sdr.goto(`${base}/leads/calling?filter=all`);
 assert.equal(await sdr.getByText(`QA Prospect ${run}`, { exact: false }).count(), 0);
 await passed("Transferred lead moves to the new owner's calling queue");

 // Research quality queue renders for the new owner.
 currentPage = sales;
 await sales.goto(`${base}/leads/research`);
 await sales.getByRole("heading", { name: "Research quality queue", exact: true }).waitFor();
 await sales.screenshot({ path: `${output}/lead-research.png`, fullPage: true });
 await passed("Research quality queue renders for the owner");

 await sales.setViewportSize({ width: 390, height: 844 });
 await sales.goto(`${base}/leads/handoffs`);
 await sales.getByRole("heading", { name: "Sales handoffs", exact: true }).waitFor();
 assert.equal(await sales.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow");
 await passed("Handoff page fits 390px viewport");

 assert.equal(report.browserErrors.length, 0, `Browser runtime errors: ${JSON.stringify(report.browserErrors)}`);
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/lead-failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/lead-failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 // Delete only this run's explicitly named fixture IDs, child rows first.
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 await clean("Handoffs", db.from("lead_handoff").delete().eq("leadId", ids.lead));
 await clean("Activities", db.from("activity").delete().eq("relatedEntityId", ids.lead));
 await clean("Audit history", db.from("audit_history").delete().eq("entityId", ids.lead));
 await clean("Lead", db.from("lead").delete().eq("id", ids.lead));
 for (const role of ["sales", "sdr"]) if (ids[role]) {
  await clean(`${role} profile`, db.from("app_user").delete().eq("id", ids[role]));
  await clean(`${role} auth`, db.auth.admin.deleteUser(ids[role]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.sdrRole, ids.salesRole]));
 const residue = await db.from("lead").select("id").eq("id", ids.lead);
 report.fixtureLeadRemaining = residue.data?.length ?? null;
 await writeFile(`${output}/lead-report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureLeadRemaining: report.fixtureLeadRemaining }, null, 2));
}
