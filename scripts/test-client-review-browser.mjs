// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Covers the client review link: a signed-out browser, with no CRM account,
// recording its own approval.
// Usage: node scripts/test-client-review-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This pilot only targets the local application.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 8);
const ids = {
 managerRole: randomUUID(), writerRole: randomUUID(), manager: null, reviewer: null, writer: null,
 project: randomUUID(), task: randomUUID(), version: randomUUID(),
};
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
const pkTime = () => new Date(Date.now() + 10 * 86400000 + 5 * 3600000).toISOString().slice(0, 16);
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/client-review-fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  { id: ids.managerRole, name: `QA cr manager ${run}`, permissions: ["project:*"], dataScope: "ALL", updatedAt: now() },
  { id: ids.writerRole, name: `QA cr writer ${run}`, permissions: ["project:read", "project:write"], dataScope: "ALL", updatedAt: now() },
 ]), "Create temporary roles");

 const passwords = {}; const emails = {};
 for (const role of ["manager", "reviewer", "writer"]) {
  passwords[role] = randomBytes(24).toString("base64url");
  emails[role] = `qa-cr-${role}-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({
   id: ids[role], fullName: `QA cr ${role}`, email: emails[role],
   roleId: role === "writer" ? ids.writerRole : ids.managerRole, status: "ACTIVE", updatedAt: now(),
  }), "Create temporary profile");
 }

 await check(db.from("project").insert({ id: ids.project, projectNumber: `QACR-${run}`, name: `QA Client Review ${run}`, projectManagerId: ids.manager, projectType: "INTERNAL", billingType: "FIXED", status: "PLANNING", updatedAt: now() }), "Create temporary project");
 await check(db.from("project_member").insert([
  { projectId: ids.project, userId: ids.writer, active: true, projectRole: "Writer", updatedAt: now() },
  { projectId: ids.project, userId: ids.reviewer, active: true, projectRole: "Reviewer", updatedAt: now() },
 ]), "Assign temporary members");
 await check(db.from("project_task").insert({ id: ids.task, projectId: ids.project, name: `QA launch caption ${run}`, assignedUserId: ids.writer, billable: false, updatedAt: now() }), "Create temporary task");

 browser = await chromium.launch({ headless: true });
 const contexts = {}; const pages = {};
 for (const role of ["manager", "reviewer", "writer"]) {
  contexts[role] = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  pages[role] = await contexts[role].newPage();
  const page = pages[role]; currentPage = page;
  page.on("pageerror", error => report.browserErrors.push({ role, message: error.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(emails[role]);
  await page.locator('input[name="password"]').fill(passwords[role]);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 30000 });
 }
 await passed("Staff sign in");
 const manager = pages.manager, reviewer = pages.reviewer, writer = pages.writer;

 // --- Set the work up through the UI, the way it actually happens ---
 const calendar = `${base}/projects/${ids.project}/content`;
 currentPage = manager;
 await manager.goto(calendar);
 await manager.getByText("Plan an existing content task", { exact: true }).click();
 await manager.getByLabel("Existing project task", { exact: true }).selectOption(ids.task);
 await manager.getByLabel("Objective", { exact: true }).fill("QA objective for the client to read");
 await manager.getByLabel("Audience", { exact: true }).fill("QA audience");
 await manager.getByLabel("Brief and brand/reference instructions", { exact: true }).fill("QA brief the client should see. Client approval required.");
 await manager.getByLabel("Planned publish time (Pakistan time)", { exact: true }).fill(pkTime());
 await manager.getByRole("button", { name: "Save content plan", exact: true }).click();
 await manager.getByRole("link", { name: "Versions, approvals & publication", exact: true }).waitFor();

 const versionUrl = `${calendar}/${ids.task}`;
 currentPage = writer;
 await writer.goto(versionUrl);
 await writer.getByText("Create version 1", { exact: true }).click();
 await writer.getByLabel("Exact caption / script / copy", { exact: true }).fill("QA COPY FOR CLIENT REVIEW");
 await writer.getByRole("button", { name: "Save new version", exact: true }).click();
 await writer.getByRole("heading", { name: "Version 1 · Current plan/version", exact: true }).waitFor();
 await passed("A version exists, awaiting internal approval");

 // --- No link may be sent before the team has approved it ---
 currentPage = manager;
 await manager.goto(versionUrl);
 assert.equal(await manager.getByRole("button", { name: "Create review link", exact: true }).count(), 0);
 await passed("The client link cannot be sent before internal approval");

 currentPage = reviewer;
 await reviewer.goto(versionUrl);
 await reviewer.getByLabel("Internal review", { exact: true }).selectOption("APPROVED");
 await reviewer.getByLabel("Review notes and asset verification evidence", { exact: true }).fill("QA internal approval. SECRET INTERNAL NOTE.");
 await reviewer.getByRole("checkbox").check();
 await reviewer.getByRole("button", { name: "Record version review", exact: true }).click();
 await reviewer.getByText("Client review link", { exact: true }).waitFor();
 await passed("Once internally approved, the client link panel appears");

 // --- Send the link ---
 currentPage = manager;
 await manager.goto(versionUrl);
 await manager.locator('input[name="recipientName"]').fill("QA Client Person");
 await manager.locator('input[name="recipientEmail"]').fill(`qa-client-${run}@example.invalid`);
 await manager.locator('select[name="expiryDays"]').selectOption("14");
 await manager.getByRole("button", { name: "Create review link", exact: true }).click();
 await manager.getByText("cannot be shown again", { exact: false }).waitFor({ timeout: 30000 });
 const linkUrl = (await manager.locator("p.font-mono").first().innerText()).trim();
 assert.ok(linkUrl.startsWith(`${base}/review/`), `Unexpected link: ${linkUrl.slice(0, 40)}`);
 await manager.screenshot({ path: `${output}/client-review-link-issued.png`, fullPage: true });
 await passed("Staff mint a review link and see it exactly once");

 const token = linkUrl.split("/review/")[1];
 const storedHash = createHash("sha256").update(token).digest("hex");
 const stored = await db.from("client_review_link").select("id,tokenHash,recipientEmail,usedAt").eq("versionId", ids.version || "").maybeSingle();
 const links = await db.from("client_review_link").select("id,tokenHash,recipientEmail,usedAt");
 const ours = (links.data ?? []).find(l => l.tokenHash === storedHash);
 assert.ok(ours, "The link was not stored under the hash of its token");
 ids.link = ours.id; await saveManifest();
 // The token itself must appear nowhere in the database.
 const raw = JSON.stringify(links.data);
 assert.ok(!raw.includes(token), "The raw token was stored in the database");
 await passed("Only the hash is stored; the token itself is nowhere in the database");

 // --- The client, in a browser with no session at all ---
 const clientContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const client = await clientContext.newPage();
 client.on("pageerror", error => report.browserErrors.push({ role: "client", message: error.message }));
 currentPage = client;

 const cookiesBefore = await clientContext.cookies();
 assert.equal(cookiesBefore.length, 0, "The client browser started with cookies");

 await client.goto(linkUrl);
 await client.getByRole("heading", { name: `QA launch caption ${run}`, exact: false }).waitFor();
 await client.getByText("QA COPY FOR CLIENT REVIEW", { exact: false }).waitFor();
 await client.getByText("QA brief the client should see", { exact: false }).waitFor();
 await client.screenshot({ path: `${output}/client-review-page.png`, fullPage: true });
 await passed("The client opens the link with no account and sees the work");

 // Nothing internal may be on that page.
 const pageText = await client.locator("body").innerText();
 assert.ok(!pageText.includes("SECRET INTERNAL NOTE"), "Internal review notes leaked to the client");
 assert.ok(!pageText.includes("QA cr manager") && !pageText.includes("QA cr writer") && !pageText.includes("QA cr reviewer"),
  "Internal staff names leaked to the client");
 assert.ok(!pageText.includes(ids.project) && !pageText.includes(ids.task), "Internal identifiers leaked to the client");
 assert.ok(!pageText.includes("Dashboard") && !pageText.includes("Invoices"), "The CRM navigation was rendered for the client");
 await passed("No internal notes, staff names, identifiers or CRM navigation reach the client");

 // A made-up token must reveal nothing, and must not say whether it ever existed.
 await client.goto(`${base}/review/${"z".repeat(43)}`);
 await client.getByText("not valid", { exact: false }).waitFor();
 const bogusText = await client.locator("body").innerText();
 assert.ok(!bogusText.includes("QA COPY FOR CLIENT REVIEW"), "A bogus token showed real content");
 await passed("An invented link reveals nothing");

 // --- The client records their own decision ---
 await client.goto(linkUrl);
 await client.getByRole("radio", { name: "Approved", exact: false }).check();
 await client.locator('input[name="approver"]').fill("QA Client Person");
 await client.locator('textarea[name="comments"]').fill("QA: approved by the client themselves.");
 await client.getByRole("button", { name: "Record my decision", exact: true }).click();
 await client.getByText("You approved this", { exact: false }).waitFor({ timeout: 30000 });
 await client.screenshot({ path: `${output}/client-review-approved.png`, fullPage: true });
 await passed("The client records their own approval");

 const review = await db.from("content_review").select("stage,decision,clientApprover,evidence,viaLinkId").eq("stage", "CLIENT").eq("viaLinkId", ids.link).maybeSingle();
 assert.ok(review.data, "The client decision did not reach content_review");
 assert.equal(review.data.decision, "APPROVED");
 assert.equal(review.data.clientApprover, "QA Client Person");
 assert.ok(review.data.viaLinkId, "The decision is not marked as made by the client");
 await passed("The decision lands in content_review, marked as the client's own");

 // Reopening shows what was decided rather than inviting a second answer.
 await client.reload();
 await client.getByText("You approved this", { exact: false }).waitFor();
 assert.equal(await client.getByRole("button", { name: "Record my decision", exact: true }).count(), 0);
 await passed("Reopening a used link shows the decision and offers no second answer");

 // --- Staff see that it was the client who decided ---
 currentPage = manager;
 await manager.goto(versionUrl);
 await manager.getByText("(recorded by the client)", { exact: false }).waitFor();
 await passed("Staff can tell a client-made decision from a transcribed one");

 // --- The approval unlocks publication, as a staff-recorded one would ---
 await manager.locator("summary").filter({ hasText: "Record publication evidence" }).waitFor();
 await passed("The client's own approval satisfies the existing publication gate");

 // --- Mobile ---
 await client.setViewportSize({ width: 390, height: 844 });
 await client.goto(linkUrl);
 await client.getByText("QA COPY FOR CLIENT REVIEW", { exact: false }).waitFor();
 assert.equal(await client.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow");
 await client.screenshot({ path: `${output}/client-review-mobile.png`, fullPage: true });
 await passed("The client page fits a 390px viewport");

 assert.equal(report.browserErrors.length, 0, `Browser runtime errors: ${JSON.stringify(report.browserErrors)}`);
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/client-review-failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/client-review-failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 // Delete only this run's explicitly named fixture IDs, child rows first.
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 const versions = await db.from("content_version").select("id").eq("taskId", ids.task);
 const versionIds = (versions.data ?? []).map(v => v.id);
 if (versionIds.length) {
  await clean("Review links", db.from("client_review_link").delete().in("versionId", versionIds));
  await clean("Publications", db.from("content_publication").delete().in("versionId", versionIds));
  await clean("Reviews", db.from("content_review").delete().in("versionId", versionIds));
  await clean("Versions", db.from("content_version").delete().in("id", versionIds));
 }
 await clean("Plan", db.from("project_content_plan").delete().eq("taskId", ids.task));
 await clean("Task", db.from("project_task").delete().eq("id", ids.task));
 await clean("Members", db.from("project_member").delete().eq("projectId", ids.project));
 await clean("Project", db.from("project").delete().eq("id", ids.project));
 for (const role of ["writer", "reviewer", "manager"]) if (ids[role]) {
  await clean(`${role} profile`, db.from("app_user").delete().eq("id", ids[role]));
  await clean(`${role} auth`, db.auth.admin.deleteUser(ids[role]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.managerRole, ids.writerRole]));
 const residue = await db.from("project").select("id").eq("id", ids.project);
 report.fixtureProjectRemaining = residue.data?.length ?? null;
 await writeFile(`${output}/client-review-report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureProjectRemaining: report.fixtureProjectRemaining }, null, 2));
}
