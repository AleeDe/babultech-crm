// Large lead imports go in batches, and the lead form works without
// customer access - in a real browser.
//
// A temporary salesperson who may work leads but not see customers imports a
// pasted file of 450 leads (three batches of 200), and opens one of them in
// the lead edit form.
//
// No email is sent: every address is example.com. Everything created is
// removed afterwards.
//
// Usage: node scripts/test-lead-import-batches-browser.mjs http://localhost:3100
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

const ROWS = 450;
const ids = { role: randomUUID(), user: null };
let browser;

try {
  await must(db.from("security_role").insert({
    id: ids.role, name: `QA Import ${run}`, permissions: ["lead:read", "lead:write"], dataScope: "OWN", updatedAt: now(),
  }), "Create the role");
  const email = `import-qa-${lower}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.user, fullName: `QA Import ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now(),
  }), "Create the user");
  pass("A salesperson who may work leads but not see customers");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  const csv = ["First name,Last name,Email,Company"]
    .concat(Array.from({ length: ROWS }, (_, i) => `Imp${i},Row ${run},imp-${lower}-${i}@example.com,QA Import Co ${run}`))
    .join("\n");
  await page.goto(`${base}/leads/import`, { waitUntil: "networkidle" });
  await page.locator("textarea").first().fill(csv);
  const button = page.getByRole("button", { name: `Import ${ROWS} leads` });
  await button.waitFor({ timeout: 20000 });
  await button.click();
  await page.waitForURL((u) => u.pathname === "/leads", { timeout: 180000 });
  const { count } = await db.from("lead").select("id", { count: "exact", head: true }).like("email", `imp-${lower}-%`);
  assert.equal(count, ROWS, `${count} of ${ROWS} imported`);
  pass(`${ROWS} leads imported in batches of 200`);

  const { count: selfNotes } = await db.from("notification").select("id", { count: "exact", head: true }).eq("userId", ids.user);
  assert.equal(selfNotes, 0, "Nobody is told about leads they imported for themselves");
  pass("Importing your own leads raises no notifications");

  const one = await must(db.from("lead").select("id").eq("email", `imp-${lower}-7@example.com`).single(), "One lead");
  await page.goto(`${base}/leads/${one.id}/edit`, { waitUntil: "networkidle" });
  await page.locator('input[name="companyName"]').waitFor({ timeout: 20000 });
  pass("The lead edit form opens without customer access");

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
  const { data: made } = await db.from("lead").select("id").like("email", `imp-${lower}-%`);
  const leadIds = (made ?? []).map((l) => l.id);
  for (let i = 0; i < leadIds.length; i += 200) {
    const part = leadIds.slice(i, i + 200);
    await clean("audit", () => db.from("audit_history").delete().in("entityId", part));
    await clean("leads", () => db.from("lead").delete().in("id", part));
  }
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
