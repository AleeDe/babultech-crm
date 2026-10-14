// Password links - in a real browser.
//
// An administrator sends a reset link from a user's page; the person opens it
// signed out, chooses a password, and signs in with it; the link then no
// longer works. A new login gets a welcome link. The Super Admin's login is
// refused to a CRM Admin. Every address is @example.com, which is never
// mailed, so the link comes back on screen to copy. Everything is removed.
//
// Usage: node scripts/test-password-link-browser.mjs http://localhost:3100
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
const strong = () => `Pw-${randomBytes(9).toString("base64url")}7Qa`;

const ids = { plainRole: randomUUID(), topRole: randomUUID(), users: [] };
let browser;

async function makeLogin(name, roleId) {
  const email = `pwl-${name}-${lower}@example.com`;
  const password = strong();
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  await must(db.from("app_user").insert({ id: auth.data.user.id, fullName: `QA ${name} ${run}`, email, roleId, status: "ACTIVE", updatedAt: now() }), `Login ${name}`);
  ids.users.push(auth.data.user.id);
  return { id: auth.data.user.id, email, password };
}

async function signIn(page, email, password) {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
}

try {
  const crm = await must(db.from("security_role").select("id").eq("name", "CRM Admin").single(), "CRM Admin");
  await must(db.from("security_role").insert({ id: ids.plainRole, name: `QA PWL Plain ${run}`, permissions: ["project:read"], dataScope: "OWN", updatedAt: now() }), "Role");
  await must(db.from("security_role").insert({ id: ids.topRole, name: `QA PWL Top ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() }), "Top role");
  const admin = await makeLogin("admin", crm.id);
  const target = await makeLogin("target", ids.plainRole);
  const top = await makeLogin("top", ids.topRole);

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await signIn(page, admin.email, admin.password);

  // Send a reset link from the user's page.
  await page.goto(`${base}/users/${target.id}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Send password reset link" }).click();
  await page.getByText(/The link was made but not emailed: Test address, not sent/).waitFor({ timeout: 30000 });
  const link = await page.getByLabel("Reset link").inputValue();
  assert.match(link, /\/reset-password\/[A-Za-z0-9_-]{40,}$/);
  const rows = await must(db.from("password_link").select("purpose, usedAt, tokenHash").eq("userId", target.id), "Links");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].purpose, "RESET");
  assert.ok(!link.includes(rows[0].tokenHash), "Only the hash is stored");
  pass("The admin button makes a reset link (shown to copy, as example.com is never mailed); only its hash is stored");

  // A second send replaces the first.
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText(/Last link \(reset\): sent .* not used yet/).waitFor();
  await page.getByRole("button", { name: "Send password reset link" }).click();
  await page.getByText(/The link was made but not emailed/).waitFor({ timeout: 30000 });
  const link2 = await page.getByLabel("Reset link").inputValue();
  assert.notEqual(link2, link);
  pass("The page shows the last link, and a new one can be sent");

  // The person opens the link, signed out.
  const visitor = await (await browser.newContext()).newPage();
  visitor.on("pageerror", (e) => errors.push({ url: visitor.url(), message: e.message }));
  await visitor.goto(link, { waitUntil: "networkidle" });
  await visitor.getByText("This link is not valid").waitFor();
  pass("The replaced link no longer works");

  await visitor.goto(link2, { waitUntil: "networkidle" });
  await visitor.getByText(target.email).waitFor();
  await visitor.locator('input[name="password"]').fill("short");
  await visitor.locator('input[name="confirm"]').fill("short");
  await visitor.getByRole("button", { name: "Set password" }).click();
  await visitor.getByText("Use at least 10 characters.").waitFor();
  const chosen = strong();
  await visitor.locator('input[name="password"]').fill(chosen);
  await visitor.locator('input[name="confirm"]').fill(chosen);
  await visitor.getByRole("button", { name: "Set password" }).click();
  await visitor.getByText("Your password is set.").waitFor({ timeout: 30000 });
  pass("Signed out, the person sees their sign-in email, weak passwords are refused, and the password is set");

  await signIn(visitor, target.email, chosen);
  pass("They sign in with the password they chose");

  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto(link2, { waitUntil: "networkidle" });
  await fresh.getByText("This link is not valid").waitFor();
  pass("A used link does not work again");

  // The Super Admin's login is not the CRM Admin's to reset.
  await page.goto(`${base}/users/${top.id}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Send password reset link" }).click();
  await page.getByText("Only the Super Admin can reset the Super Admin's password.").waitFor({ timeout: 30000 });
  assert.equal((await must(db.from("password_link").select("id").eq("userId", top.id), "Top links")).length, 0);
  pass("A CRM Admin cannot send a link for the Super Admin's login");

  // A new login gets a welcome link.
  await page.goto(`${base}/users/new`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: new RegExp(`QA PWL Plain ${run}`) }).click();
  await page.locator('input[name="email"]').fill(`pwl-new-${lower}@example.com`);
  await page.locator('input[name="password"]').fill(strong());
  await page.locator('input[name="fullName"]').fill(`QA new ${run}`);
  await page.getByRole("button", { name: "Create user" }).click();
  const created = await until(async () => (await db.from("app_user").select("id").eq("email", `pwl-new-${lower}@example.com`).maybeSingle()).data, "new login");
  ids.users.push(created.id);
  const welcome = await until(async () => (await db.from("password_link").select("purpose").eq("userId", created.id)).data?.[0], "welcome link");
  assert.equal(welcome.purpose, "WELCOME");
  await page.goto(`${base}/users/${created.id}`, { waitUntil: "networkidle" });
  await page.getByText(/Last link \(welcome\): sent .*, not emailed/).waitFor();
  pass("A new login gets a welcome link, shown on their page");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  for (const user of ids.users) {
    await db.from("password_link").delete().eq("userId", user);
    await db.from("audit_history").delete().eq("entityId", user);
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record", "team_member"]) await db.from(t).delete().eq("userId", user);
    await db.from("audit_history").delete().eq("changedById", user);
    await db.from("email").delete().eq("relatedEntityType", "User").eq("relatedEntityId", user);
    await db.from("app_user").delete().eq("id", user);
    await db.auth.admin.deleteUser(user).catch(() => {});
  }
  await db.from("security_role").delete().in("id", [ids.plainRole, ids.topRole]);
  console.log("Temporary data removed.");
}
