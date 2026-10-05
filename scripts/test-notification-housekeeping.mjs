// Notification clean-up: read ones go after 7 days, unread ones stay.
//
// Writes notifications for a temporary login, runs the nightly clean-up and
// checks only the right ones went. Everything created is removed; no email is
// sent (example.com, and every row is already past sending).
//
// Usage: node scripts/test-notification-housekeeping.mjs
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

config({ path: ".env", quiet: true });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const run = randomUUID().slice(0, 6).toUpperCase();
const passed = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
const now = () => new Date().toISOString();
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

const ids = { role: randomUUID(), user: null };
const rows = {
  readOld: { "inApp": true, readAt: daysAgo(8), createdAt: daysAgo(10) },
  readRecent: { "inApp": true, readAt: daysAgo(2), createdAt: daysAgo(10) },
  unreadOld: { "inApp": true, readAt: null, createdAt: daysAgo(60) },
  emailSentOld: { "inApp": false, emailStatus: "SENT", emailedAt: daysAgo(8), createdAt: daysAgo(8) },
  emailSentRecent: { "inApp": false, emailStatus: "SENT", emailedAt: daysAgo(1), createdAt: daysAgo(1) },
  emailPendingOld: { "inApp": false, emailStatus: "PENDING", createdAt: daysAgo(20) },
  overdueReadOld: { "inApp": true, readAt: daysAgo(10), createdAt: daysAgo(12), dedupeKey: `overdue:${randomUUID()}` },
  overdueReadVeryOld: { "inApp": true, readAt: daysAgo(32), createdAt: daysAgo(33), dedupeKey: `overdue:${randomUUID()}` },
};
const expectGone = ["readOld", "emailSentOld", "overdueReadVeryOld"];

try {
  await must(db.from("security_role").insert({ id: ids.role, name: `QA Housekeeping ${run}`, permissions: [], dataScope: "OWN", updatedAt: now() }), "Role");
  const email = `nhk-${run.toLowerCase()}@example.com`;
  const auth = await db.auth.admin.createUser({ email, password: randomBytes(24).toString("base64url"), email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({ id: ids.user, fullName: `QA Housekeeping ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now() }), "Login");

  for (const [name, fields] of Object.entries(rows)) {
    fields.id = randomUUID();
    await must(db.from("notification").insert({ userId: ids.user, kind: "QA", title: `QA ${name} ${run}`, ...fields }), name);
  }
  pass("Eight notifications of every kind, old and recent");

  const removed = await must(db.rpc("notification_housekeeping"), "Clean-up");
  assert.ok(removed >= expectGone.length, `Removed ${removed}`);
  const left = new Set((await must(db.from("notification").select("id").eq("userId", ids.user), "Left")).map((r) => r.id));
  for (const [name, fields] of Object.entries(rows)) {
    assert.equal(left.has(fields.id), !expectGone.includes(name), `${name} ${expectGone.includes(name) ? "should be gone" : "should stay"}`);
  }
  pass("Read more than 7 days ago: gone");
  pass("Read in the last 7 days, and unread however old: kept");
  pass("Email-only: gone 7 days after sending; one still waiting to send is kept");
  pass("A read overdue reminder is kept 31 days, so the task is not reminded about again");

  const jobs = await db.schema("cron").from("job").select("jobname").eq("jobname", "babultech-notification-housekeeping");
  if (!jobs.error) {
    assert.equal(jobs.data.length, 1);
    pass("Scheduled nightly");
  }
  console.log(`\n${passed.length} checks passed.\n`);
} finally {
  const failures = [];
  const clean = async (what, fn) => {
    try {
      const r = await fn();
      if (r?.error) failures.push(`${what}: ${r.error.message}`);
    } catch (err) {
      failures.push(`${what}: ${err.message}`);
    }
  };
  if (ids.user) {
    await clean("notifications", () => db.from("notification").delete().eq("userId", ids.user));
    for (const t of ["record_follow", "recent_record", "login_event", "favorite_record"]) await clean(t, () => db.from(t).delete().eq("userId", ids.user));
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
