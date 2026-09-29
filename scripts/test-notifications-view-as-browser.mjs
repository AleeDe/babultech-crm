// Notifications, following, sign-in history and View as, in a real browser.
//
// Two temporary people: an administrator and a salesperson. A lead is assigned
// to the salesperson, who sees it under the bell, opens it, follows and
// unfollows it and changes a notification setting. The administrator then
// views the CRM as the salesperson - sees their lead, cannot change it - and
// exits, and every step shows in the security history. An administrator cannot
// be viewed as.
//
// No email is sent: both addresses are example.com, which the notification
// mailer never sends to, and nothing here queues a mass email.
//
// Everything created is removed afterwards.
//
// Usage: node scripts/test-notifications-view-as-browser.mjs http://localhost:3100
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

const ids = { adminRole: randomUUID(), salesRole: randomUUID(), admin: null, sales: null, lead: randomUUID() };
const people = {};
let browser;

async function makeUser(key, roleId, name) {
  const email = `${key}-qa-${run.toLowerCase()}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  await must(db.from("app_user").insert({
    id: auth.data.user.id, fullName: name, email, roleId, status: "ACTIVE", updatedAt: now(),
  }), `Create ${name}`);
  people[key] = { email, password, name, id: auth.data.user.id };
  return auth.data.user.id;
}

async function signIn(page, who) {
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
}

try {
  await must(db.from("security_role").insert({
    id: ids.adminRole, name: `QA Admin ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now(),
  }), "Create the admin role");
  await must(db.from("security_role").insert({
    id: ids.salesRole, name: `QA Sales ${run}`, permissions: ["lead:read", "lead:write", "account:read"], dataScope: "OWN", updatedAt: now(),
  }), "Create the sales role");
  ids.admin = await makeUser("admin", ids.adminRole, `QA Admin ${run}`);
  ids.sales = await makeUser("sales", ids.salesRole, `QA Sales ${run}`);

  // Assigned by "the system" (the service role), so the salesperson is told.
  await must(db.from("lead").insert({
    id: ids.lead, leadNumber: `QA-NV-${run}`, firstName: "Qa", lastName: `Bell ${run}`, companyName: `QA Bell Co ${run}`,
    email: `lead-${run.toLowerCase()}@example.com`, ownerUserId: ids.sales, status: "NEW", updatedAt: now(),
  }), "Create a lead for the salesperson");
  const notes = await must(db.from("notification").select("kind, title, emailStatus").eq("userId", ids.sales).eq("entityId", ids.lead), "Read notifications");
  assert.equal(notes.length, 1, "One notification for the new owner");
  assert.equal(notes[0].kind, "ASSIGNED");
  assert.equal(notes[0].emailStatus, "PENDING", "Assignments go by email unless turned off");
  const follows = await must(db.from("record_follow").select("userId").eq("entityId", ids.lead), "Read follows");
  assert.deepEqual(follows.map((f) => f.userId), [ids.sales], "The owner follows it automatically");
  // Mark it so no email would ever be attempted, whatever the scheduler does.
  await must(db.from("notification").update({ emailStatus: "SKIPPED" }).eq("userId", ids.sales), "Park the email");
  pass("Assigning a lead notifies its owner, who follows it automatically");

  browser = await chromium.launch({ headless: true });

  // --- The salesperson ------------------------------------------------------
  const salesCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await salesCtx.newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await signIn(page, people.sales);

  const events = await must(db.from("login_event").select("eventType").eq("userId", ids.sales), "Read sign-ins");
  assert.ok(events.some((e) => e.eventType === "SIGN_IN"), "The sign-in is recorded");
  pass("Signing in is recorded in the sign-in history");

  const bell = page.getByRole("button", { name: /Notifications, 1 unread/ }).first();
  await bell.waitFor({ timeout: 20000 });
  await bell.click();
  const item = page.getByRole("menuitem", { name: new RegExp(`Lead assigned to you: Qa Bell ${run}`) });
  await item.waitFor({ timeout: 10000 });
  pass("The bell shows one unread notification: the assignment");

  await item.click();
  await page.waitForURL(new RegExp(`/leads/${ids.lead}`), { timeout: 20000 });
  await page.getByRole("heading", { name: new RegExp(`Qa Bell ${run}`) }).first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Notifications", exact: true }).first().waitFor({ timeout: 20000 });
  const read = await must(db.from("notification").select("readAt").eq("userId", ids.sales).eq("entityId", ids.lead).single(), "Read state");
  assert.ok(read.readAt, "Opening it marks it read");
  pass("Opening it goes to the lead and marks it read");

  const followButton = page.getByRole("button", { name: /^Following$/ });
  await followButton.waitFor({ timeout: 10000 }).catch(async (err) => {
    console.log("URL:", page.url());
    console.log("PAGE:", (await page.locator("main").innerText().catch(() => "no main")).slice(0, 600));
    throw err;
  });
  await followButton.click();
  await page.getByRole("button", { name: /^Follow$/ }).waitFor({ timeout: 10000 });
  let row = await db.from("record_follow").select("userId").eq("entityId", ids.lead).eq("userId", ids.sales);
  assert.equal(row.data.length, 0, "Unfollowing removes the follow");
  await page.getByRole("button", { name: /^Follow$/ }).click();
  await page.getByRole("button", { name: /^Following$/ }).waitFor({ timeout: 10000 });
  row = await db.from("record_follow").select("userId").eq("entityId", ids.lead).eq("userId", ids.sales);
  assert.equal(row.data.length, 1, "Following adds it back");
  pass("Follow and unfollow from the lead's page");

  await page.goto(`${base}/notifications/settings`, { waitUntil: "networkidle" });
  const emailBox = page.getByRole("checkbox", { name: "Assigned to me by email" });
  assert.equal(await emailBox.isChecked(), true, "Assignments are emailed by default");
  await emailBox.uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByText("Saved.").waitFor({ timeout: 10000 });
  const pref = await must(db.from("notification_preference").select("inApp, email").eq("userId", ids.sales).eq("kind", "ASSIGNED").single(), "Read preference");
  assert.deepEqual(pref, { inApp: true, email: false });
  await must(db.from("lead").update({ ownerUserId: ids.admin, updatedAt: now() }).eq("id", ids.lead), "Reassign away");
  await must(db.from("lead").update({ ownerUserId: ids.sales, updatedAt: now() }).eq("id", ids.lead), "And back");
  const again = await must(db.from("notification").select("emailStatus").eq("userId", ids.sales).eq("kind", "ASSIGNED").order("createdAt", { ascending: false }).limit(1).single(), "Latest");
  assert.equal(again.emailStatus, null, "With email off, the next assignment is the bell only");
  pass("Turning an email off in settings is honoured on the next notification");

  await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
  await page.getByText("Your recent sign-ins").waitFor({ timeout: 10000 });
  assert.match(await page.locator("body").innerText(), /Signed in/, "Their own sign-in is listed");
  pass("My account lists recent sign-ins");
  await salesCtx.close();

  // --- The administrator ----------------------------------------------------
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const admin = await adminCtx.newPage();
  admin.on("pageerror", (e) => errors.push({ url: admin.url(), message: e.message }));
  await signIn(admin, people.admin);

  // An administrator cannot be viewed as.
  await admin.goto(`${base}/users/${ids.admin}`, { waitUntil: "networkidle" });
  assert.equal(await admin.getByRole("button", { name: "View as" }).isDisabled(), true, "Not yourself, nor an administrator");
  pass("View as is refused for an administrator");

  await admin.goto(`${base}/users/${ids.sales}`, { waitUntil: "networkidle" });
  await admin.getByRole("button", { name: "View as" }).click();
  await admin.getByRole("dialog").getByRole("textbox").fill(`QA check ${run}: cannot see a lead`);
  await admin.getByRole("button", { name: "Start View as" }).click();
  await admin.getByText(`YOU ARE VIEWING AS QA SALES ${run}`).waitFor({ timeout: 30000 });
  pass("Starting View as shows the banner");

  await admin.goto(`${base}/leads`, { waitUntil: "networkidle" });
  await admin.getByText(`YOU ARE VIEWING AS QA SALES ${run}`).waitFor({ timeout: 20000 });
  const leadsText = await admin.locator("body").innerText();
  assert.match(leadsText, new RegExp(`Bell ${run}`), "Their lead is listed");
  const nav = await admin.locator("aside").innerText();
  assert.ok(!/Invoices/.test(nav) && !/Users/.test(nav), "Their menu, not the administrator's");
  pass("During View as the lead list and the menu are the salesperson's");

  // A change is refused.
  await admin.goto(`${base}/leads/${ids.lead}/edit`, { waitUntil: "networkidle" });
  const company = admin.locator('input[name="companyName"]');
  await company.waitFor({ timeout: 20000 }).catch(async (err) => {
    console.log("EDIT PAGE:", admin.url(), (await admin.locator("body").innerText()).slice(0, 800));
    throw err;
  });
  await company.fill(`Changed ${run}`);
  await admin.getByRole("button", { name: /Save/ }).first().click();
  await admin.getByText(/nothing can be changed/i).first().waitFor({ timeout: 20000 });
  const unchanged = await must(db.from("lead").select("companyName").eq("id", ids.lead).single(), "Read lead");
  assert.equal(unchanged.companyName, `QA Bell Co ${run}`, "The lead is unchanged");
  pass("A change during View as is refused and nothing is saved");

  await admin.getByRole("button", { name: "Exit View as" }).click();
  await admin.waitForURL(new RegExp(`/users/${ids.sales}`), { timeout: 30000 });
  await admin.getByRole("heading", { name: `QA Sales ${run}` }).waitFor({ timeout: 20000 });
  assert.equal(await admin.getByText(/YOU ARE VIEWING AS/).count(), 0, "The banner is gone");
  const session = await must(db.from("view_as_session").select("reason, endedAt").eq("adminUserId", ids.admin).single(), "Read the session");
  assert.ok(session.endedAt, "The session is ended");
  pass("Exit View as returns to the user's page and ends the session");

  await admin.goto(`${base}/users/security?type=VIEW_AS_START`, { waitUntil: "networkidle" });
  const history = await admin.locator("body").innerText();
  assert.match(history, new RegExp(`QA check ${run}`), "The reason is in the security history");
  const trail = await must(db.from("login_event").select("eventType").eq("userId", ids.admin), "Admin events");
  assert.ok(trail.some((e) => e.eventType === "VIEW_AS_START") && trail.some((e) => e.eventType === "VIEW_AS_END"), "Start and end recorded");
  pass("The security history shows the View as with its reason, start and end");

  await admin.goto(`${base}/jobs`, { waitUntil: "networkidle" });
  await admin.getByText("Scheduler").first().waitFor({ timeout: 10000 });
  pass("The background jobs page loads, with the scheduler card");

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
  const userIds = [ids.admin, ids.sales].filter(Boolean);
  await clean("view sessions", () => db.from("view_as_session").delete().in("adminUserId", userIds.length ? userIds : [randomUUID()]));
  await clean("sign-ins", () => db.from("login_event").delete().in("userId", userIds.length ? userIds : [randomUUID()]));
  await clean("sign-ins by address", () => db.from("login_event").delete().ilike("email", `%-qa-${run.toLowerCase()}@example.com`));
  await clean("lead", () => db.from("lead").delete().eq("id", ids.lead));
  await clean("audit", () => db.from("audit_history").delete().eq("entityId", ids.lead));
  for (const id of userIds) {
    await clean("user", () => db.from("app_user").delete().eq("id", id));
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
  await clean("roles", () => db.from("security_role").delete().in("id", [ids.adminRole, ids.salesRole]));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
