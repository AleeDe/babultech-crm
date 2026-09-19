// Real Chromium + local app + temporary Supabase identities. Never prints secrets.
// Usage: node scripts/test-content-browser.mjs http://localhost:3100
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
const ids = { managerRole: randomUUID(), writerRole: randomUUID(), manager: null, writer: null, project: randomUUID(), task: randomUUID() };
const output = "artifacts/browser-qa";
await mkdir(output, { recursive: true });
const report = { run, passed: [], failed: null, browserErrors: [], cleanup: [] };
const now = () => new Date().toISOString();
const pkTime = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 19);
async function check(result, operation) { const value = await result; if (value.error) throw new Error(`${operation}: ${value.error.message}`); return value.data; }
async function passed(name) { report.passed.push(name); console.log(`PASS ${name}`); }
async function saveManifest() { await writeFile(`${output}/fixtures-${run}.json`, JSON.stringify(ids, null, 2)); }
let browser;
let currentPage;
try {
 await check(db.from("security_role").insert([
  { id: ids.managerRole, name: `QA manager ${run}`, permissions: ["project:*"], dataScope: "OWN", updatedAt: now() },
  { id: ids.writerRole, name: `QA writer ${run}`, permissions: ["project:read", "project:write"], dataScope: "OWN", updatedAt: now() },
 ]), "Create temporary roles");
 const passwords = { manager: randomBytes(24).toString("base64url"), writer: randomBytes(24).toString("base64url") };
 const emails = { manager: `qa-manager-${run}@example.com`, writer: `qa-writer-${run}@example.com` };
 for (const role of ["manager", "writer"]) {
  const auth = await db.auth.admin.createUser({ email: emails[role], password: passwords[role], email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids[role] = auth.data.user.id; await saveManifest();
  await check(db.from("app_user").insert({ id: ids[role], fullName: `QA ${role}`, email: emails[role], roleId: ids[`${role}Role`], status: "ACTIVE", updatedAt: now() }), "Create temporary profile");
  const authProbe = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await authProbe.auth.signInWithPassword({ email: emails[role], password: passwords[role] });
  if (verified.error) throw new Error(`Temporary ${role} auth preflight: ${verified.error.code ?? verified.error.message}`);
  await authProbe.auth.signOut();
 }
 await check(db.from("project").insert({ id: ids.project, projectNumber: `QA-${run}`, name: "QA Content Workflow", projectManagerId: ids.manager, projectType: "INTERNAL", billingType: "FIXED", status: "PLANNING", updatedAt: now() }), "Create temporary project");
 await check(db.from("project_member").insert({ projectId: ids.project, userId: ids.writer, active: true, projectRole: "Writer", updatedAt: now() }), "Assign temporary writer");
 await check(db.from("project_task").insert({ id: ids.task, projectId: ids.project, name: "QA launch caption", assignedUserId: ids.writer, billable: false, updatedAt: now() }), "Create temporary task");
 browser = await chromium.launch({ headless: true });
 const contexts = { manager: await browser.newContext({ viewport: { width: 1440, height: 1000 } }), writer: await browser.newContext({ viewport: { width: 1440, height: 1000 } }) };
 const pages = { manager: await contexts.manager.newPage(), writer: await contexts.writer.newPage() };
 for (const role of ["manager", "writer"]) {
  const page = pages[role]; currentPage = page;
  page.on("pageerror", error => report.browserErrors.push({ role, message: error.message }));
  await page.goto(`${base}/login`);
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await page.getByRole("button", { name: "Hide password", exact: true }).waitFor();
  await page.locator('input[name="email"]').fill(emails[role]);
  await page.locator('input[name="password"]').fill(passwords[role]);
  if (await page.locator('input[name="password"]').inputValue() !== passwords[role]) throw new Error("Login input did not retain test password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith("/login"), { timeout: 30000 });
  await passed(`${role} UI login`);
 }
 const calendar = `${base}/projects/${ids.project}/content`;
 const versionUrl = `${calendar}/${ids.task}`;
 const pm = pages.manager, writer = pages.writer;
 currentPage = pm;
 await pm.goto(calendar);
 await pm.getByRole("heading", { name: "Content planning calendar", exact: true }).waitFor();
 await pm.getByText("Plan an existing content task", { exact: true }).click();
 await pm.getByLabel("Existing project task", { exact: true }).selectOption(ids.task);
 await pm.getByLabel("Objective", { exact: true }).fill("Introduce the launch to shop owners");
 await pm.getByLabel("Audience", { exact: true }).fill("Retailers");
 await pm.getByLabel("Brief and brand/reference instructions", { exact: true }).fill("QA brief: factual, concise caption. Client approval required.");
 await pm.getByLabel("Planned publish time (Pakistan time)", { exact: true }).fill(pkTime().slice(0, 16));
 await pm.getByRole("button", { name: "Save content plan", exact: true }).click();
 await pm.getByRole("link", { name: "Versions, approvals & publication", exact: true }).waitFor();
 await pm.screenshot({ path: `${output}/calendar.png`, fullPage: true });
 await passed("PM creates plan through UI; calendar renders task and metadata");
 currentPage = writer;
 await writer.goto(calendar);
 assert.equal(await writer.getByText("Plan an existing content task", { exact: true }).count(), 0);
 await writer.getByRole("link", { name: "Versions, approvals & publication", exact: true }).click();
 await writer.getByText("Create version 1", { exact: true }).click();
 await writer.getByLabel("Exact caption / script / copy", { exact: true }).fill("QA version 1: accurate launch caption.");
 await writer.getByRole("button", { name: "Save new version", exact: true }).click();
 await writer.getByRole("heading", { name: "Version 1 · Current plan/version", exact: true }).waitFor();
 assert.equal(await writer.getByRole("button", { name: "Record version review", exact: true }).count(), 0);
 assert.equal(await writer.locator("summary").filter({ hasText: "Record publication evidence" }).count(), 0);
 await passed("Writer creates version; planning, self-review and unapproved publication controls hidden");
 currentPage = pm;
 const editorRole = await check(db.from("security_role").select("id").eq("name", "Content Editor").single(), "Find editor preset");
 await check(db.from("app_user").update({ roleId: editorRole.id }).eq("id", ids.manager), "Switch only QA reviewer to editor preset");
 await pm.goto(versionUrl);
 await pm.getByLabel("Internal review", { exact: true }).selectOption("APPROVED");
 await pm.getByLabel("Review notes and asset verification evidence", { exact: true }).fill("QA independent copy review completed; no asset attached.");
 await pm.getByRole("checkbox").check();
 await pm.getByRole("button", { name: "Record version review", exact: true }).click();
 await pm.getByText("QA independent copy review completed; no asset attached.", { exact: true }).waitFor();
 assert.equal(await pm.getByLabel("Received client decision", { exact: true }).count(), 0);
 assert.equal(await pm.locator("summary").filter({ hasText: "Record publication evidence" }).count(), 0);
 await passed("Content Editor preset reviews internally without client approval or publication controls");
 await pm.screenshot({ path: `${output}/editor-review.png`, fullPage: true });
 await check(db.from("app_user").update({ roleId: ids.managerRole }).eq("id", ids.manager), "Restore QA manager role");
 await pm.reload();
 await pm.getByLabel("Received client decision", { exact: true }).waitFor();
 assert.equal(await pm.locator("summary").filter({ hasText: "Record publication evidence" }).count(), 0);
 await passed("Internal review succeeds; required client review still gates publication");
 await pm.getByLabel("Received client decision", { exact: true }).selectOption("APPROVED");
 await pm.getByLabel("Client approver name", { exact: true }).fill("QA Client Reviewer");
 await pm.getByLabel("Client decision evidence / reference and date", { exact: true }).fill("Synthetic QA approval evidence, no client message sent.");
 await pm.getByRole("checkbox").check();
 await pm.getByRole("button", { name: "Record version review", exact: true }).click();
 await pm.locator("summary").filter({ hasText: "Record publication evidence" }).waitFor();
 await passed("Client evidence accepted and publication control unlocked");
 currentPage = writer;
 await writer.reload();
 await writer.locator("summary").filter({ hasText: "Record publication evidence" }).click();
 await writer.getByLabel("Live publication URL", { exact: true }).fill("https://example.com/qa-content-not-a-real-post");
 await writer.getByLabel("Actual publication time (Pakistan time)", { exact: true }).fill(pkTime());
 await writer.getByRole("button", { name: "Record publication evidence", exact: true }).click();
 await writer.getByRole("link", { name: "Live URL", exact: true }).waitFor();
 await writer.screenshot({ path: `${output}/approved-publication.png`, fullPage: true });
 await passed("Writer records synthetic publication evidence; unique embed renders without crashing");
 await writer.getByText("Create version 2", { exact: true }).click();
 await writer.getByLabel("Exact caption / script / copy", { exact: true }).fill("QA version 2: updated copy requires a new review.");
 await writer.getByRole("button", { name: "Save new version", exact: true }).click();
 await writer.getByRole("heading", { name: "Version 2 · Current plan/version", exact: true }).waitFor();
 assert.equal(await writer.locator("summary").filter({ hasText: "Record publication evidence" }).count(), 0);
 await passed("New version does not inherit approval; historical publication preserved");
 await writer.setViewportSize({ width: 390, height: 844 });
 await writer.screenshot({ path: `${output}/versions-mobile.png`, fullPage: true });
 assert.equal(await writer.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Mobile horizontal overflow");
 await passed("Mobile version page fits 390px viewport");
 await check(db.from("project_member").update({ active: false }).eq("projectId", ids.project).eq("userId", ids.writer), "Revoke only test membership");
 await writer.reload();
 assert.equal(await writer.getByText("QA version 2: updated copy requires a new review.", { exact: true }).count(), 0);
 await passed("Revoked writer loses version-page access");
 assert.equal(report.browserErrors.length, 0, "Browser runtime errors captured");
} catch (error) {
 report.failed = error.message; console.error(`FAIL ${error.message}`);
 if (currentPage) { await currentPage.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/failure-text.txt`, await currentPage.locator("body").innerText().catch(() => "Page unavailable")); }
 process.exitCode = 1;
} finally {
 if (browser) await browser.close();
 // Delete only this run's explicitly named fixture IDs, child rows first.
 async function clean(name, query) { try { await check(query, name); report.cleanup.push(`${name}: OK`); } catch (error) { report.cleanup.push(`${name}: ${error.message}`); process.exitCode = 1; } }
 const versions = await db.from("content_version").select("id").eq("taskId", ids.task);
 const versionIds = (versions.data ?? []).map(v => v.id);
 if (versions.error) { report.cleanup.push("Version lookup failed"); process.exitCode = 1; }
 if (versionIds.length) {
  await clean("Publications", db.from("content_publication").delete().in("versionId", versionIds));
  await clean("Reviews", db.from("content_review").delete().in("versionId", versionIds));
  await clean("Versions", db.from("content_version").delete().in("id", versionIds));
 }
 await clean("Plan", db.from("project_content_plan").delete().eq("taskId", ids.task));
 await clean("Task", db.from("project_task").delete().eq("id", ids.task));
 await clean("Members", db.from("project_member").delete().eq("projectId", ids.project));
 await clean("Project", db.from("project").delete().eq("id", ids.project));
 for (const role of ["writer", "manager"]) if (ids[role]) {
  await clean(`${role} profile`, db.from("app_user").delete().eq("id", ids[role]));
  await clean(`${role} auth`, db.auth.admin.deleteUser(ids[role]));
 }
 await clean("Roles", db.from("security_role").delete().in("id", [ids.managerRole, ids.writerRole]));
 const residue = await db.from("project").select("id").eq("id", ids.project);
 report.fixtureProjectRemaining = residue.data?.length ?? null;
 await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
 console.log(JSON.stringify({ passed: report.passed.length, failed: report.failed, cleanup: report.cleanup, fixtureProjectRemaining: report.fixtureProjectRemaining }, null, 2));
}
