// Productivity: quote approval rules, automatic rules, boards and reports -
// in a real browser.
//
// A temporary administrator adds an approval rule and finds a large quote has
// to be approved before it is sent; switches on the stale-deal rule and sees it
// remind the owner; moves a lead and a deal on the boards; and runs, downloads
// and schedules a report.
//
// The approval rule is removed afterwards and every automatic rule is put back
// exactly as it was found. Everything else created is removed. No email is
// sent: the only address involved is example.com.
//
// Usage: node scripts/test-productivity-browser.mjs http://localhost:3100
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
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = {
  role: randomUUID(), user: null, account: randomUUID(), deal: randomUUID(), staleDeal: randomUUID(), quote: randomUUID(), lead: randomUUID(),
};
let browser;
let rulesBefore = null;

try {
  rulesBefore = await must(db.from("automation_rule").select("key, enabled, config"), "Read the automatic rules");
  await must(db.from("security_role").insert({ id: ids.role, name: `QA Productivity ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() }), "Role");
  const email = `productivity-qa-${lower}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({ id: ids.user, fullName: `QA Productivity ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now() }), "User");
  await must(db.from("account").insert({ id: ids.account, accountNumber: `QA-PD-${run}`, name: `QA Productivity Co ${run}`, accountType: "CUSTOMER", ownerUserId: ids.user, updatedAt: now() }), "Account");
  await must(db.from("opportunity").insert([
    { id: ids.deal, opportunityNumber: `QA-PD-D-${run}`, name: `QA Board deal ${run}`, accountId: ids.account, ownerUserId: ids.user, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: now().slice(0, 10), createdAt: now(), updatedAt: now() },
    { id: ids.staleDeal, opportunityNumber: `QA-PD-S-${run}`, name: `QA Stale deal ${run}`, accountId: ids.account, ownerUserId: ids.user, stage: "NEGOTIATION", amount: 0, currencyCode: "PKR", expectedCloseDate: now().slice(0, 10), createdAt: daysAgo(40), updatedAt: daysAgo(40) },
  ]), "Deals");
  await must(db.from("quotation").insert({
    id: ids.quote, quoteNumber: `QA-PD-Q-${run}`, opportunityId: ids.deal, accountId: ids.account, versionNumber: 1, status: "DRAFT",
    quoteDate: now().slice(0, 10), expiryDate: daysAgo(-30).slice(0, 10), currencyCode: "PKR", subtotal: 5000, totalAmount: 5000, updatedAt: now(),
  }), "Quote");
  await must(db.from("quote_line").insert({ quotationId: ids.quote, description: "QA line", quantity: 1, unitPrice: 5000, sortOrder: 0 }), "Quote line");
  await must(db.from("lead").insert({ id: ids.lead, leadNumber: `QA-PD-L-${run}`, firstName: "Board", lastName: `Lead ${run}`, ownerUserId: ids.user, status: "NEW", updatedAt: now() }), "Lead");
  await db.from("notification").update({ emailStatus: "SKIPPED" }).eq("userId", ids.user);
  pass("An administrator, a deal with a 5,000 quote, a deal untouched for 40 days, and a lead");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept("Went with a competitor") : d.accept()));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  // --- Approval rules -----------------------------------------------------------
  await page.goto(`${base}/settings/automation`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Large quotes").fill(`QA rule ${run}`);
  await page.getByPlaceholder("500,000").fill("1000");
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByText(`QA rule ${run}`).waitFor({ timeout: 15000 });
  pass("An approval rule is added: quotes over 1,000");

  await page.goto(`${base}/quotations/${ids.quote}`, { waitUntil: "networkidle" });
  await page.getByText(/the total is over PKR 1,000\.00/).waitFor({ timeout: 20000 });
  assert.equal(await page.getByRole("button", { name: "Mark as sent" }).count(), 0, "It cannot simply be sent");
  await page.getByRole("button", { name: "Send for approval" }).click();
  await page.getByRole("button", { name: "Approve" }).waitFor({ timeout: 30000 });
  let q = await must(db.from("quotation").select("status, approvalStatus").eq("id", ids.quote).single(), "Quote");
  assert.deepEqual(q, { status: "UNDER_REVIEW", approvalStatus: "PENDING" });
  pass("A quote over the limit goes for approval instead of out");

  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("button", { name: "Mark as sent" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByText(/With the customer/).waitFor({ timeout: 30000 });
  q = await must(db.from("quotation").select("status, approvalStatus").eq("id", ids.quote).single(), "Quote");
  assert.deepEqual(q, { status: "SENT", approvalStatus: "APPROVED" });
  pass("Once approved, it can be sent");

  // --- Automatic rules ------------------------------------------------------------
  await page.goto(`${base}/settings/automation`, { waitUntil: "networkidle" });
  await page.getByLabel("Deal not moving on").check();
  await page.getByLabel("Deal not moving days").fill("30");
  const staleCard = page.locator("div.rounded-md.border", { has: page.getByText("Deal not moving", { exact: true }) });
  await staleCard.getByRole("button", { name: "Save" }).click();
  await staleCard.getByText("Saved.").waitFor({ timeout: 15000 });
  const rule = await must(db.from("automation_rule").select("enabled, config").eq("key", "DEAL_STALE").single(), "Rule");
  assert.equal(rule.enabled, true);
  assert.equal(rule.config.days, 30);
  await must(db.rpc("automation_tick"), "Run the rules");
  const reminders = await must(db.from("notification").select("title").eq("userId", ids.user).eq("kind", "AUTOMATION"), "Reminders");
  assert.ok(reminders.some((n) => n.title === `Deal has not moved: QA Stale deal ${run}`), "The owner is reminded about the stale deal");
  assert.ok(!reminders.some((n) => n.title.includes(`QA Board deal ${run}`)), "Not about a deal that moved today");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Reminded the owner: no movement for 30 days").first().waitFor({ timeout: 15000 });
  pass("The stale-deal rule reminds the owner, and the log shows it");

  // --- Boards -----------------------------------------------------------------------
  await page.goto(`${base}/leads/board`, { waitUntil: "networkidle" });
  await page.getByLabel(`Move Board Lead ${run} to`).selectOption("CONTACTED");
  await page.locator('section[data-column="CONTACTED"]').getByText(`Board Lead ${run}`).waitFor({ timeout: 15000 });
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal((await must(db.from("lead").select("status").eq("id", ids.lead).single(), "Lead")).status, "CONTACTED");
  pass("Moving a lead on the board changes its status");

  await page.goto(`${base}/opportunities/board`, { waitUntil: "networkidle" });
  await page.getByLabel(`Move QA Stale deal ${run} to`).selectOption("CLOSED_LOST");
  await page.locator('section[data-column="CLOSED_LOST"]').getByText(`QA Stale deal ${run}`).waitFor({ timeout: 15000 });
  await new Promise((r) => setTimeout(r, 2500));
  const lost = await must(db.from("opportunity").select("stage, lossReason").eq("id", ids.staleDeal).single(), "Deal");
  assert.deepEqual(lost, { stage: "CLOSED_LOST", lossReason: "Went with a competitor" });
  await page.getByLabel(`Move QA Board deal ${run} to`).selectOption("CLOSED_WON");
  await page.getByRole("alert").waitFor({ timeout: 15000 });
  assert.equal((await must(db.from("opportunity").select("stage").eq("id", ids.deal).single(), "Deal")).stage === "CLOSED_WON", false);
  // The card goes back to where it was: Quote submitted, since its quote was sent.
  await page.locator('section[data-column="QUOTE_SUBMITTED"]').getByText(`QA Board deal ${run}`).waitFor({ timeout: 15000 });
  pass("The deal board asks why a deal was lost, and refuses a win the deal is not ready for");

  await page.goto(`${base}/cases/board`, { waitUntil: "networkidle" });
  await page.getByRole("region", { name: "New" }).waitFor({ timeout: 15000 });
  await page.goto(`${base}/my-work/board`, { waitUntil: "networkidle" });
  await page.getByRole("region", { name: "In progress" }).waitFor({ timeout: 15000 });
  pass("The case and task boards open");

  // --- Reports ------------------------------------------------------------------------
  await page.goto(`${base}/reports/won-lost`, { waitUntil: "networkidle" });
  const table = await page.locator("table").innerText();
  assert.match(table, /Total/);
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.getByRole("button", { name: "CSV", exact: true }).click(),
  ]);
  assert.match(download.suggestedFilename(), /won-and-lost-by-month\.csv/);
  await page.getByRole("button", { name: "Send me this weekly" }).click();
  await page.getByRole("button", { name: "Sent to you weekly" }).waitFor({ timeout: 15000 });
  const schedule = await must(db.from("report_schedule").select("id, link").eq("userId", ids.user).single(), "Schedule");
  assert.equal(schedule.link, "/reports/won-lost");
  await must(db.from("report_schedule").update({ nextRunAt: daysAgo(1) }).eq("id", schedule.id), "Make it due");
  await must(db.rpc("report_schedules_tick"), "Run the schedules");
  const ready = await must(db.from("notification").select("title, link").eq("userId", ids.user).eq("kind", "REPORT_READY"), "Report notifications");
  assert.deepEqual(ready.map((n) => n.link), ["/reports/won-lost"]);
  for (const key of ["pipeline", "lead-sources", "case-times", "time-by-project"]) {
    const res = await page.goto(`${base}/reports/${key}`, { waitUntil: "networkidle" });
    assert.ok((res?.status() ?? 0) < 400, `${key} opens`);
  }
  pass("Reports run, download as CSV, and a scheduled one arrives as a notification");

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
  // The rules exactly as they were found.
  if (rulesBefore) {
    for (const r of rulesBefore) {
      await clean(`rule ${r.key}`, () => db.from("automation_rule").update({ enabled: r.enabled, config: r.config }).eq("key", r.key));
    }
  }
  await clean("approval rule", () => db.from("approval_rule").delete().eq("name", `QA rule ${run}`));
  await clean("automation log", () => db.from("automation_log").delete().in("entityId", [ids.deal, ids.staleDeal, ids.lead]));
  await clean("quote lines", () => db.from("quote_line").delete().eq("quotationId", ids.quote));
  await clean("quote", () => db.from("quotation").delete().eq("id", ids.quote));
  await clean("deals", () => db.from("opportunity").delete().in("id", [ids.deal, ids.staleDeal]));
  await clean("lead", () => db.from("lead").delete().eq("id", ids.lead));
  await clean("account", () => db.from("account").delete().eq("id", ids.account));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.deal, ids.staleDeal, ids.quote, ids.lead, ids.account]));
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
