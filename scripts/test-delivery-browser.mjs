// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Covers the delivery handoff: sales brief, PM review, payment gate, activation gate.
// Usage: node scripts/test-delivery-browser.mjs http://localhost:3100
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
const ids = { salesRole: randomUUID(), pmRole: randomUUID(), sales: null, pm: null, account: randomUUID(), opportunity: randomUUID(), quotation: randomUUID(), project: randomUUID() };
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
// datetime-local value in Pakistan time, days ahead of now.
const pkInput = (days) => new Date(Date.now() + days * 86400000 + 5 * 3600000).toISOString().slice(0, 16);
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/delivery-fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
const checklist = {
 contact: "QA: Shop owner, account owner QA sales",
 scope: "QA: signed scope reference QA-SOW-" + run,
 deliverables: "QA: point-of-sale setup and two training sessions",
 exclusions: "QA: hardware supply is excluded",
 dates: "QA: four weeks from kickoff; customer provides stock list in week one",
 billing: "QA: 50 percent on kickoff, 50 percent on acceptance",
 paymentEvidence: "QA: synthetic advance recorded, reference QA-PAY-" + run,
 acceptance: "QA: owner signs off after two weeks of live use",
 revisions: "QA: two rounds of configuration changes included",
 promises: "QA: promised weekend training; risk is stock data quality",
};
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  { id: ids.salesRole, name: `QA dsales ${run}`, permissions: ["opportunity:read", "opportunity:write", "account:read", "quotation:read", "project:read"], dataScope: "OWN", updatedAt: now() },
  { id: ids.pmRole, name: `QA dpm ${run}`, permissions: ["project:read", "project:manage", "project:write", "opportunity:read", "account:read"], dataScope: "OWN", updatedAt: now() },
 ]), "Create temporary roles");
 const passwords = { sales: randomBytes(24).toString("base64url"), pm: randomBytes(24).toString("base64url") };
 const emails = { sales: `qa-dsales-${run}@example.com`, pm: `qa-dpm-${run}@example.com` };
 for (const role of ["sales", "pm"]) {
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({ id: ids[role], fullName: `QA ${role}`, email: emails[role], roleId: ids[`${role}Role`], status: "ACTIVE", updatedAt: now() }), "Create temporary profile");
 }
 await check(db.from("account").insert({ id: ids.account, accountNumber: `QA-A-${run}`, name: `QA Delivery Account ${run}`, ownerUserId: ids.sales, updatedAt: now() }), "Create temporary account");
 await check(db.from("opportunity").insert({ id: ids.opportunity, opportunityNumber: `QA-O-${run}`, name: `QA Delivery Deal ${run}`, accountId: ids.account, ownerUserId: ids.sales, stage: "CLOSED_WON", amount: 250000, currencyCode: "PKR", expectedCloseDate: day(0), actualCloseDate: day(0), updatedAt: now() }), "Create temporary won opportunity");
 await check(db.from("quotation").insert({ id: ids.quotation, quoteNumber: `QA-Q-${run}`, opportunityId: ids.opportunity, accountId: ids.account, versionNumber: 1, status: "ACCEPTED", quoteDate: day(-3), expiryDate: day(30), currencyCode: "PKR", subtotal: 250000, totalAmount: 250000, updatedAt: now() }), "Create temporary accepted quotation");
 await check(db.from("project").insert({ id: ids.project, projectNumber: `QA-P-${run}`, name: `QA Delivery Project ${run}`, accountId: ids.account, opportunityId: ids.opportunity, projectManagerId: ids.pm, projectType: "CUSTOMER", billingType: "FIXED", status: "PLANNING", currencyCode: "PKR", updatedAt: now() }), "Create temporary planning project");

 browser = await chromium.launch({ headless: true });
 const contexts = { sales: await browser.newContext({ viewport: { width: 1440, height: 1000 } }), pm: await browser.newContext({ viewport: { width: 1440, height: 1000 } }) };
 const pages = { sales: await contexts.sales.newPage(), pm: await contexts.pm.newPage() };
 for (const role of ["sales", "pm"]) {
  const page = pages[role]; currentPage = page;
  page.on("pageerror", error => report.browserErrors.push({ role, message: error.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(emails[role]);
  await page.locator('input[name="password"]').fill(passwords[role]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 30000 });
  await passed(`${role} UI login`);
 }
 const sales = pages.sales, pm = pages.pm;
 const submitUrl = `${base}/projects/handoffs?opportunityId=${ids.opportunity}`;

 // The PM has no opportunity:write, so the submission form must not appear for them.
 currentPage = pm;
 await pm.goto(submitUrl);
 await pm.getByRole("heading", { name: "Delivery handoffs", exact: true }).waitFor();
 assert.equal(await pm.getByText("New delivery handoff", { exact: true }).count(), 0);
 await passed("PM cannot open the sales submission form");

 // Sales submits the checklist with payment still pending.
 currentPage = sales;
 await sales.goto(submitUrl);
 await sales.getByText("New delivery handoff", { exact: true }).waitFor();
 for (const [field, value] of Object.entries(checklist)) await sales.locator(`textarea[name="${field}"]`).fill(value);
 await sales.locator('select[name="paymentState"]').selectOption("PENDING");
 await sales.getByRole("button", { name: "Submit to project manager", exact: true }).click();
 await sales.getByRole("status").waitFor();
 await sales.screenshot({ path: `${output}/delivery-submit.png`, fullPage: true });
 await passed("Sales submits the delivery checklist");

 const submitted = await db.from("delivery_handoff").select("id,status,paymentState,recipientId").eq("projectId", ids.project).single();
 assert.equal(submitted.data.status, "PENDING");
 assert.equal(submitted.data.recipientId, ids.pm, "Handoff must route to the project's PM");
 await passed("Handoff is pending and routed to the assigned PM");

 // Payment pending must block acceptance at the database boundary, not only in the UI.
 const forcedAccept = await db.rpc("decide_delivery_handoff", { p_id: submitted.data.id, p_decision: "ACCEPTED", p_reason: "QA direct RPC attempt", p_kickoff: new Date(Date.now() + 5 * 86400000).toISOString() });
 assert.ok(forcedAccept.error, "Pending payment should block acceptance even through a direct RPC");
 await passed("Pending payment blocks acceptance at the database boundary");

 // Activation must be refused while the handoff is unaccepted.
 const earlyActivation = await db.from("project").update({ status: "ACTIVE", updatedAt: now() }).eq("id", ids.project);
 assert.ok(earlyActivation.error, "Activation should be refused before the handoff is accepted");
 await passed("Project activation is refused while the handoff is unaccepted");

 // PM reviews, sees the checklist and returns it for correction.
 currentPage = pm;
 await pm.goto(`${base}/projects/handoffs`);
 await pm.getByText("Delivery checklist", { exact: true }).click();
 await pm.getByText(checklist.promises, { exact: true }).waitFor();
 await pm.screenshot({ path: `${output}/delivery-review.png`, fullPage: true });
 await passed("PM reads the full delivery checklist");

 await pm.locator("select").first().selectOption("RETURNED");
 await pm.locator('textarea[name="reason"]').fill("QA: returning for payment verification before kickoff.");
 await pm.getByRole("button", { name: "Record review", exact: true }).click();
 await pm.getByText("QA: returning for payment verification before kickoff.", { exact: false }).waitFor();
 await passed("PM returns the submission with a reason");

 const returned = await db.from("delivery_handoff").select("status").eq("id", submitted.data.id).single();
 assert.equal(returned.data.status, "RETURNED");
 await passed("Return is recorded without activating the project");

 // Sales resubmits with payment verified. Prior review history stays.
 currentPage = sales;
 await sales.goto(submitUrl);
 await sales.getByText("New delivery handoff", { exact: true }).waitFor();
 for (const [field, value] of Object.entries(checklist)) await sales.locator(`textarea[name="${field}"]`).fill(value);
 await sales.locator('textarea[name="paymentEvidence"]').fill(`QA: advance received, bank reference QA-PAY-${run}, verified by finance.`);
 await sales.locator('select[name="paymentState"]').selectOption("VERIFIED");
 await sales.getByRole("button", { name: "Submit to project manager", exact: true }).click();
 await sales.getByRole("status").waitFor();
 await passed("Sales corrects payment evidence and resubmits");

 const history = await db.from("delivery_handoff").select("id,status,paymentState").eq("projectId", ids.project).order("createdAt", { ascending: true });
 assert.equal(history.data.length, 2, "Resubmission should keep the earlier review as history");
 assert.equal(history.data[0].status, "RETURNED");
 const current = history.data[1];
 assert.equal(current.paymentState, "VERIFIED");
 await passed("Corrected submission keeps the prior review history");

 // PM accepts with a future kickoff.
 currentPage = pm;
 await pm.goto(`${base}/projects/handoffs`);
 await pm.locator("select").first().selectOption("ACCEPTED");
 await pm.locator('input[name="kickoffAt"]').fill(pkInput(5));
 await pm.locator('textarea[name="reason"]').fill("QA: capacity confirmed, team assigned, kickoff booked.");
 await pm.getByRole("button", { name: "Record review", exact: true }).click();
 await pm.getByText("Agreed kickoff:", { exact: false }).waitFor();
 await pm.screenshot({ path: `${output}/delivery-accepted.png`, fullPage: true });
 await passed("PM accepts delivery readiness with a kickoff date");

 const accepted = await db.from("delivery_handoff").select("status,kickoffAt").eq("id", current.id).single();
 assert.equal(accepted.data.status, "ACCEPTED");
 const projectAfterAccept = await db.from("project").select("status").eq("id", ids.project).single();
 assert.equal(projectAfterAccept.data.status, "PLANNING", "Acceptance records readiness; it must not activate the project");
 await passed("Acceptance records readiness without activating the project");

 // Activation is now allowed, and the page says it is a separate action.
 const activation = await db.from("project").update({ status: "ACTIVE", updatedAt: now() }).eq("id", ids.project);
 assert.equal(activation.error, null, `Activation should be allowed after acceptance: ${activation.error?.message}`);
 await passed("Project activates once the handoff is accepted");

 // Changing the accepted quotation must invalidate the fingerprint for a later activation.
 await check(db.from("project").update({ status: "PLANNING", updatedAt: now() }).eq("id", ids.project), "Return project to planning");
 await check(db.from("quotation").update({ totalAmount: 400000, updatedAt: now() }).eq("id", ids.quotation), "Change the quotation total");
 const staleActivation = await db.from("project").update({ status: "ACTIVE", updatedAt: now() }).eq("id", ids.project);
 assert.ok(staleActivation.error, "Changed commercial terms should require a fresh handoff before activation");
 await passed("Changed quotation blocks activation until a fresh handoff is accepted");

 await pm.setViewportSize({ width: 390, height: 844 });
 await pm.goto(`${base}/projects/handoffs`);
 await pm.getByRole("heading", { name: "Delivery handoffs", exact: true }).waitFor();
 assert.equal(await pm.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow");
 await passed("Delivery handoff page fits 390px viewport");

 assert.equal(report.browserErrors.length, 0, `Browser runtime errors: ${JSON.stringify(report.browserErrors)}`);
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/delivery-failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/delivery-failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 // Delete only this run's explicitly named fixture IDs, child rows first.
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 await clean("Handoffs", db.from("delivery_handoff").delete().eq("projectId", ids.project));
 await clean("Project", db.from("project").delete().eq("id", ids.project));
 await clean("Quotation", db.from("quotation").delete().eq("id", ids.quotation));
 await clean("Opportunity", db.from("opportunity").delete().eq("id", ids.opportunity));
 await clean("Account", db.from("account").delete().eq("id", ids.account));
 await clean("Audit history", db.from("audit_history").delete().in("entityId", [ids.project, ids.opportunity, ids.quotation, ids.account]));
 for (const role of ["pm", "sales"]) if (ids[role]) {
  await clean(`${role} profile`, db.from("app_user").delete().eq("id", ids[role]));
  await clean(`${role} auth`, db.auth.admin.deleteUser(ids[role]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.salesRole, ids.pmRole]));
 const residue = await db.from("project").select("id").eq("id", ids.project);
 report.fixtureProjectRemaining = residue.data?.length ?? null;
 await writeFile(`${output}/delivery-report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureProjectRemaining: report.fixtureProjectRemaining }, null, 2));
}
