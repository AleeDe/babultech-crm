// Our team finding a partner's records, in a real browser.
//
// The lead, account and deal lists each narrow to one partner, the account list
// says who brought each account, and an account's page says so too. Records
// are made for one partner and one of our own, so a filter that ignored the
// partner would show both.
//
// Everything created is removed afterwards.
//
// Usage: node scripts/test-partner-filters-browser.mjs http://localhost:3100
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

const ids = {
  role: randomUUID(), user: null, partnerAccount: randomUUID(), partner: randomUUID(),
  theirLead: randomUUID(), ourLead: randomUUID(),
  theirAccount: randomUUID(), ourAccount: randomUUID(),
  theirDeal: randomUUID(), ourDeal: randomUUID(),
};
let browser;

try {
  await must(db.from("security_role").insert({
    id: ids.role, name: `Filters QA ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now(),
  }), "Create the role");
  const email = `filters-qa-${run.toLowerCase()}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.user, fullName: `Filters QA ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now(),
  }), "Create the user");

  await must(db.from("account").insert({
    id: ids.partnerAccount, accountNumber: `QFB-P-${run}`, name: `QA Filter Partner Co ${run}`,
    accountType: "PARTNER", ownerUserId: ids.user, updatedAt: now(),
  }), "Create the partner's company");
  await must(db.from("partner").insert({
    id: ids.partner, partnerNumber: `QFB-${run}`, displayName: `QA Filter Partner ${run}`, kind: "COMPANY",
    accountId: ids.partnerAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: ids.user, defaultCommissionPercent: 10, updatedAt: now(),
  }), "Create the partner");

  await must(db.from("lead").insert([
    { id: ids.theirLead, leadNumber: `QFB-L1-${run}`, firstName: "Tariq", lastName: `Theirs ${run}`, referredByPartnerId: ids.partner, ownerUserId: ids.user, status: "NEW", updatedAt: now() },
    { id: ids.ourLead, leadNumber: `QFB-L2-${run}`, firstName: "Omar", lastName: `Ours ${run}`, referredByPartnerId: null, ownerUserId: ids.user, status: "NEW", updatedAt: now() },
  ]), "Create a lead of theirs and one of ours");
  await must(db.from("account").insert([
    { id: ids.theirAccount, accountNumber: `QFB-A1-${run}`, name: `QA Filter Theirs ${run}`, accountType: "PROSPECT", ownerUserId: ids.user, sourcePartnerId: ids.partner, updatedAt: now() },
    { id: ids.ourAccount, accountNumber: `QFB-A2-${run}`, name: `QA Filter Ours ${run}`, accountType: "PROSPECT", ownerUserId: ids.user, sourcePartnerId: null, updatedAt: now() },
  ]), "Create an account of theirs and one of ours");
  await must(db.from("opportunity").insert([
    { id: ids.theirDeal, opportunityNumber: `QFB-D1-${run}`, name: `QA Filter Their Deal ${run}`, accountId: ids.theirAccount, ownerUserId: ids.user, stage: "DISCOVERY", amount: 100, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: ids.partner, updatedAt: now() },
    { id: ids.ourDeal, opportunityNumber: `QFB-D2-${run}`, name: `QA Filter Our Deal ${run}`, accountId: ids.ourAccount, ownerUserId: ids.user, stage: "DISCOVERY", amount: 100, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: null, updatedAt: now() },
  ]), "Create a deal of theirs and one of ours");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  const open = async (path) => {
    const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    assert.ok((res?.status() ?? 0) < 400, `${path} returned ${res?.status()}`);
    return page.locator("body").innerText();
  };

  let body = await open(`/leads?partnerId=${ids.partner}`);
  assert.ok(body.includes(`Tariq Theirs ${run}`), "The partner's lead is listed");
  assert.ok(!body.includes(`Omar Ours ${run}`), "Ours is not");
  assert.ok(await page.getByLabel("Partner").isVisible(), "With the filter on the page");
  pass("Leads narrow to one partner");

  body = await open(`/accounts?partnerId=${ids.partner}`);
  assert.ok(body.includes(`QA Filter Theirs ${run}`), "The partner's account is listed");
  assert.ok(!body.includes(`QA Filter Ours ${run}`), "Ours is not");
  assert.ok(body.includes(`QA Filter Partner ${run}`), "With who brought it in its own column");
  pass("Accounts narrow to one partner, and say who brought each");

  body = await open(`/opportunities?partnerId=${ids.partner}`);
  assert.ok(body.includes(`QA Filter Their Deal ${run}`), "The partner's deal is listed");
  assert.ok(!body.includes(`QA Filter Our Deal ${run}`), "Ours is not");
  pass("Deals narrow to one partner");

  body = await open(`/accounts/${ids.theirAccount}`);
  assert.match(body, new RegExp(`Brought to us by\\s+QA Filter Partner ${run}`), "The account page names the partner");
  body = await open(`/accounts/${ids.ourAccount}`);
  assert.ok(!/Brought to us by/.test(body), "And says nothing on one of ours");
  pass("An account's page says which partner brought it, and only when one did");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  const failures = [];
  const step = async (what, fn) => {
    const r = await fn();
    if (r?.error) failures.push(`${what}: ${r.error.message}`);
  };
  const deals = [ids.theirDeal, ids.ourDeal];
  const { data: records } = await db.from("partner_commission").select("id").in("opportunityId", deals);
  const recordIds = (records ?? []).map((r) => r.id);
  if (recordIds.length) await step("commission history", () => db.from("audit_history").delete().in("entityId", recordIds));
  await step("deals", () => db.from("opportunity").delete().in("id", deals));
  await step("leads", () => db.from("lead").delete().in("id", [ids.theirLead, ids.ourLead]));
  await step("accounts", () => db.from("account").delete().in("id", [ids.theirAccount, ids.ourAccount]));
  await step("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await step("partner company", () => db.from("account").delete().eq("id", ids.partnerAccount));
  if (ids.user) {
    await step("user", () => db.from("app_user").delete().eq("id", ids.user));
    await db.auth.admin.deleteUser(ids.user).catch(() => {});
  }
  await step("role", () => db.from("security_role").delete().eq("id", ids.role));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
