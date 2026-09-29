// Saved views, recently opened records and the recycle bin, in a real browser.
//
// A temporary salesperson with two leads saves a filtered view of the lead
// list as their default and finds the list opens with it; opens a lead and
// finds it under "recently opened" in the search box and on My work; deletes
// it to the recycle bin and restores it; and finds a converted lead cannot be
// deleted.
//
// Everything created is removed afterwards.
//
// Usage: node scripts/test-views-recent-recycle-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

config({ path: ".env", quiet: true });

const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  throw new Error("This check only targets the local application.");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 6).toUpperCase();
const now = () => new Date().toISOString();
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = { role: randomUUID(), user: null, open: randomUUID(), contacted: randomUUID() };
let browser;

try {
  await must(db.from("security_role").insert({
    id: ids.role, name: `QA Views ${run}`, permissions: ["lead:read", "lead:write", "lead:delete", "account:read"], dataScope: "OWN", updatedAt: now(),
  }), "Create the role");
  const email = `views-qa-${run.toLowerCase()}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.user, fullName: `QA Views ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now(),
  }), "Create the user");

  await must(db.from("lead").insert([
    { id: ids.open, leadNumber: `QA-V1-${run}`, firstName: "Qa", lastName: `Open ${run}`, companyName: `QA Open Co ${run}`,
      email: `open-${run.toLowerCase()}@example.com`, ownerUserId: ids.user, status: "NEW", updatedAt: now() },
    { id: ids.contacted, leadNumber: `QA-V2-${run}`, firstName: "Qa", lastName: `Contacted ${run}`, companyName: `QA Contacted Co ${run}`,
      email: `contacted-${run.toLowerCase()}@example.com`, ownerUserId: ids.user, status: "CONTACTED", updatedAt: now() },
  ]), "Create two leads");
  await db.from("notification").update({ emailStatus: "SKIPPED" }).eq("userId", ids.user);
  pass("A salesperson with two leads, one New and one Contacted");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  // --- Saved views ------------------------------------------------------------
  await page.goto(`${base}/leads?status=CONTACTED`, { waitUntil: "networkidle" });
  await page.getByText(`Contacted ${run}`).first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /^Views/ }).click();
  await page.getByRole("menuitem", { name: "Save current view…" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(`Contacted ${run}`);
  await page.getByRole("dialog").getByLabel("Open this list with this view").check();
  await page.getByRole("button", { name: "Save view" }).click();
  await page.getByRole("button", { name: new RegExp(`Contacted ${run}`) }).waitFor({ timeout: 15000 });
  const view = await must(db.from("saved_view").select("query, isDefault").eq("userId", ids.user).single(), "Read the view");
  assert.deepEqual(view, { query: "status=CONTACTED", isDefault: true });
  pass("Save the filtered list as a view, made the default");

  await page.goto(`${base}/leads`, { waitUntil: "networkidle" });
  await page.waitForURL(/\/leads\?status=CONTACTED/, { timeout: 15000 });
  let body = await page.locator("body").innerText();
  assert.ok(body.includes(`Contacted ${run}`) && !body.includes(`Open ${run}`), "The default view opens");
  pass("Arriving at the list opens the default view");

  await page.getByRole("button", { name: new RegExp(`Contacted ${run}`) }).click();
  await page.getByRole("menuitem", { name: "All records" }).click();
  await page.waitForURL(/\/leads\?all=1/, { timeout: 15000 });
  await page.getByText(`Open ${run}`).first().waitFor({ timeout: 15000 });
  pass("All records shows the unfiltered list");

  // --- Recent records ---------------------------------------------------------
  await page.goto(`${base}/leads/${ids.open}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: new RegExp(`Open ${run}`) }).first().waitFor({ timeout: 20000 });
  const recent = await must(db.from("recent_record").select("label").eq("userId", ids.user), "Read recent");
  assert.deepEqual(recent.map((r) => r.label), [`Qa Open ${run}`]);
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog").getByText(`Qa Open ${run}`).waitFor({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await page.goto(`${base}/my-work`, { waitUntil: "networkidle" });
  await page.getByText("Recently opened").waitFor({ timeout: 10000 });
  assert.match(await page.locator("body").innerText(), new RegExp(`Qa Open ${run}`));
  pass("An opened lead is listed as recent in the search box and on My work");

  // --- Recycle bin ------------------------------------------------------------
  await page.goto(`${base}/leads/${ids.open}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Delete" }).click();
  await page.waitForURL((u) => u.pathname === "/leads", { timeout: 20000 });
  const hidden = await must(db.from("lead").select("deletedAt, deletedById").eq("id", ids.open).single(), "Read lead");
  assert.ok(hidden.deletedAt && hidden.deletedById === ids.user, "Hidden, with who deleted it");
  await page.goto(`${base}/leads?all=1`, { waitUntil: "networkidle" });
  body = await page.locator("body").innerText();
  assert.ok(!body.includes(`Open ${run}`) && body.includes(`Contacted ${run}`), "Gone from the list");
  pass("Delete moves the lead out of the list");

  await page.goto(`${base}/recycle-bin`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: `Qa Open ${run}` });
  await row.waitFor({ timeout: 15000 });
  assert.match(await row.innerText(), /90 days|89 days/);
  await row.getByRole("button", { name: "Restore" }).click();
  await row.waitFor({ state: "detached", timeout: 15000 });
  const back = await must(db.from("lead").select("deletedAt, deletedById").eq("id", ids.open).single(), "Read lead");
  assert.deepEqual(back, { deletedAt: null, deletedById: null });
  const trail = await must(db.from("audit_history").select("oldValue, newValue").eq("entityId", ids.open).eq("fieldName", "deletedAt"), "Audit");
  assert.equal(trail.length, 2, "Delete and restore are both in the history");
  pass("The recycle bin lists it with days left, and Restore brings it back");

  await must(db.from("lead").update({ convertedAt: now(), status: "CONVERTED" }).eq("id", ids.contacted), "Mark converted");
  await page.goto(`${base}/leads/${ids.contacted}`, { waitUntil: "networkidle" });
  const del = page.getByRole("button", { name: "Delete" });
  await del.waitFor({ timeout: 15000 });
  assert.equal(await del.isDisabled(), true, "A converted lead cannot be deleted");
  assert.match(await del.getAttribute("title"), /converted/);
  pass("A converted lead cannot be deleted, and the button says why");

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
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.open, ids.contacted]));
  await clean("leads", () => db.from("lead").delete().in("id", [ids.open, ids.contacted]));
  if (ids.user) {
    await clean("sign-ins", () => db.from("login_event").delete().eq("userId", ids.user));
    await clean("user", () => db.from("app_user").delete().eq("id", ids.user));
    await db.auth.admin.deleteUser(ids.user).catch(() => {});
  }
  await clean("role", () => db.from("security_role").delete().eq("id", ids.role));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
