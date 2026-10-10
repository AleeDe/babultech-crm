// Changing a pre-filled search field - in a real browser.
//
// A project's manager is changed on its edit form: the new person stays
// chosen (they used to snap back to the old one) and is what gets saved.
// Everything created is removed.
//
// Usage: node scripts/test-lookup-change-browser.mjs http://localhost:3100
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
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what) {
  for (let i = 0; i < 40; i++) {
    const v = await fn();
    if (v) return v;
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const ids = { role: randomUUID(), admin: null, other: null, project: randomUUID() };
let browser;

async function makeLogin(name) {
  const email = `lkp-${name}-${lower}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  await must(db.from("app_user").insert({ id: auth.data.user.id, fullName: `QA Lookup ${name} ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now() }), `Login ${name}`);
  return { id: auth.data.user.id, email, password };
}

try {
  await must(db.from("security_role").insert({ id: ids.role, name: `QA Lookup ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() }), "Role");
  const admin = await makeLogin("admin");
  const other = await makeLogin("manager");
  Object.assign(ids, { admin: admin.id, other: other.id });
  await must(db.from("project").insert({
    id: ids.project, projectNumber: `QA-LKP-${run}`, name: `QA Lookup Project ${run}`, projectManagerId: admin.id,
    billingType: "FIXED", projectType: "INTERNAL", status: "ACTIVE", updatedAt: now(),
  }), "Project");
  pass("A project managed by one person, and another person to hand it to");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(admin.email);
  await page.locator('input[name="password"]').fill(admin.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  await page.goto(`${base}/projects/${ids.project}/edit`, { waitUntil: "networkidle" });
  const hidden = page.locator('input[type="hidden"][name="projectManagerId"]');
  assert.equal(await hidden.inputValue(), admin.id);
  await page.getByRole("button", { name: new RegExp(`QA Lookup admin ${run}`) }).click();
  await page.getByPlaceholder("Search people…").fill(`QA Lookup manager ${run}`);
  await page.getByRole("option", { name: new RegExp(`QA Lookup manager ${run}`) }).click();
  await wait(1500); // the old value used to come back about now
  assert.equal(await hidden.inputValue(), other.id, "The new manager stays chosen");
  await page.getByRole("button", { name: new RegExp(`QA Lookup manager ${run}`) }).waitFor();
  pass("Choosing a new project manager keeps them chosen; the old one no longer comes back");

  await page.getByRole("button", { name: "Save changes" }).click();
  await until(async () => (await db.from("project").select("projectManagerId").eq("id", ids.project).single()).data?.projectManagerId === other.id, "saved");
  pass("Saving stores the new project manager");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
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
  await clean("audit", () => db.from("audit_history").delete().eq("entityId", ids.project));
  await clean("project members", () => db.from("project_member").delete().eq("projectId", ids.project));
  await clean("project", () => db.from("project").delete().eq("id", ids.project));
  for (const user of [ids.admin, ids.other].filter(Boolean)) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record"]) await clean(t, () => db.from(t).delete().eq("userId", user));
    await clean("audit by user", () => db.from("audit_history").delete().eq("changedById", user));
    await clean("user", () => db.from("app_user").delete().eq("id", user));
    await db.auth.admin.deleteUser(user).catch(() => {});
  }
  await clean("role", () => db.from("security_role").delete().eq("id", ids.role));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
