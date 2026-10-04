// Every salesperson sees, and works, every partner's records - in a real
// browser, as a salesperson on no team, who by scope sees only their own.
//
// The partner's lead, account and deal are owned by somebody else, as they are
// in practice (the partner's manager), beside a lead, account and deal of ours
// owned by the same person. The salesperson must find the partner's in every
// list, the pipeline and the lookups, open and price the deal, and see the
// call the partner logged - and see none of ours.
//
// Everything created is removed afterwards.
//
// Usage: node scripts/test-partner-records-sales-browser.mjs http://localhost:3100
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
const tag = run.toLowerCase();
const now = () => new Date().toISOString();
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
const step = (no, title) => { console.log(`\n${no}  ${title}`); console.log("─".repeat(64)); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = {
  role: randomUUID(), seller: null,
  partnerAccount: randomUUID(), partner: randomUUID(), partnerLogin: randomUUID(),
  theirLead: randomUUID(), ourLead: randomUUID(),
  theirAccount: randomUUID(), ourAccount: randomUUID(), theirContact: randomUUID(),
  theirDeal: randomUUID(), ourDeal: randomUUID(),
  product: randomUUID(), book: randomUUID(), entry: randomUUID(),
};
let browser;

try {
  step("00", "A partner's records and ours, all owned by somebody else, and a salesperson on no team");

  const owner = await must(
    db.from("app_user").select("id").eq("userType", "INTERNAL").eq("status", "ACTIVE").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  );
  await must(db.from("security_role").insert({
    id: ids.role, name: `QA P5 Sales ${run}`, dataScope: "TEAM", updatedAt: now(),
    permissions: ["lead:*", "account:*", "opportunity:*", "partner:read"],
  }), "Create the sales role");
  const email = `qa-p5-seller-${tag}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.seller = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.seller, fullName: `QA P5 Seller ${run}`, email, roleId: ids.role, userType: "INTERNAL",
    status: "ACTIVE", updatedAt: now(),
  }), "Create the salesperson");

  await must(db.from("account").insert({
    id: ids.partnerAccount, accountNumber: `QP5-PA-${run}`, name: `QA P5 Partner Co ${run}`,
    accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now(),
  }), "Create the partner's company");
  await must(db.from("partner").insert({
    id: ids.partner, partnerNumber: `QP5-${run}`, displayName: `QA P5 Partner ${run}`, kind: "COMPANY",
    accountId: ids.partnerAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: owner.id, defaultCommissionPercent: 10, updatedAt: now(),
  }), "Create the partner");
  const partnerRole = await must(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  await must(db.from("app_user").insert({
    id: ids.partnerLogin, fullName: `QA P5 Partner Person ${run}`, email: `qa-p5-partner-${tag}@example.com`,
    roleId: partnerRole.id, userType: "PARTNER", portalRole: "ADMIN", partnerId: ids.partner, status: "ACTIVE", updatedAt: now(),
  }), "Create the partner's login record");

  await must(db.from("lead").insert([
    { id: ids.theirLead, leadNumber: `QP5-L1-${run}`, firstName: "Tahir", lastName: `Theirs ${run}`, status: "NEW", ownerUserId: owner.id, referredByPartnerId: ids.partner, updatedAt: now() },
    { id: ids.ourLead, leadNumber: `QP5-L2-${run}`, firstName: "Umar", lastName: `Ours ${run}`, status: "NEW", ownerUserId: owner.id, referredByPartnerId: null, updatedAt: now() },
  ]), "Create a lead of theirs and one of ours");
  await must(db.from("account").insert([
    { id: ids.theirAccount, accountNumber: `QP5-A1-${run}`, name: `QA P5 Their Customer ${run}`, accountType: "PROSPECT", ownerUserId: owner.id, sourcePartnerId: ids.partner, updatedAt: now() },
    { id: ids.ourAccount, accountNumber: `QP5-A2-${run}`, name: `QA P5 Our Customer ${run}`, accountType: "PROSPECT", ownerUserId: owner.id, sourcePartnerId: null, updatedAt: now() },
  ]), "Create an account of theirs and one of ours");
  await must(db.from("contact").insert({
    id: ids.theirContact, accountId: ids.theirAccount, firstName: "Tania", lastName: `Contact ${run}`,
    email: `qa-p5-tania-${tag}@example.com`, updatedAt: now(),
  }), "Create their customer's contact");
  await must(db.from("opportunity").insert([
    { id: ids.theirDeal, opportunityNumber: `QP5-D1-${run}`, name: `QA P5 Their Deal ${run}`, accountId: ids.theirAccount, ownerUserId: owner.id, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: ids.partner, updatedAt: now() },
    { id: ids.ourDeal, opportunityNumber: `QP5-D2-${run}`, name: `QA P5 Our Deal ${run}`, accountId: ids.ourAccount, ownerUserId: owner.id, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: null, updatedAt: now() },
  ]), "Create a deal of theirs and one of ours");
  await must(db.from("activity").insert({
    activityType: "CALL", subject: `QA P5 partner call ${run}`, ownerUserId: ids.partnerLogin,
    relatedEntityType: "Opportunity", relatedEntityId: ids.theirDeal, updatedAt: now(),
  }), "Log the partner's call on their deal");
  await must(db.from("product").insert({
    id: ids.product, productCode: "auto", name: `QA P5 Item ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now(),
  }), "Create an item");
  await must(db.from("price_book").insert({
    id: ids.book, name: `QA P5 Book ${run}`, currencyCode: "PKR", active: true, updatedAt: now(),
  }), "Create a price book");
  await must(db.from("price_book_entry").insert({
    id: ids.entry, priceBookId: ids.book, productId: ids.product, quantity: 1, rate: 4000, licenseCost: 0,
    maintenanceCost: 0, cloudCost: 0, aiCost: 0, active: true, updatedAt: now(),
  }), "Price it");
  pass("Records ready");

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

  step("01", "The lists");

  let body = await open(`/leads?search=${encodeURIComponent(run)}`);
  assert.ok(body.includes(`Tahir Theirs ${run}`), "The partner's lead is listed");
  assert.ok(!body.includes(`Umar Ours ${run}`), "Ours, owned by somebody else, is not");
  body = await open(`/accounts?search=${encodeURIComponent(run)}`);
  assert.ok(body.includes(`QA P5 Their Customer ${run}`), "The partner's account is listed");
  assert.ok(!body.includes(`QA P5 Our Customer ${run}`), "Ours is not");
  body = await open(`/opportunities`);
  assert.ok(body.includes(`QA P5 Their Deal ${run}`), "The partner's deal is listed");
  assert.ok(!body.includes(`QA P5 Our Deal ${run}`), "Ours is not");
  pass("Leads, accounts and deals list the partner's records, and none of ours owned by somebody else");

  step("02", "The partner's deal, its people and the partner's call");

  body = await open(`/accounts/${ids.theirAccount}`);
  assert.ok(body.includes(`Tania Contact ${run}`), "The partner customer's contact shows on it");
  body = await open(`/opportunities/${ids.theirDeal}`);
  assert.ok(body.includes(`QA P5 Their Deal ${run}`), "The deal opens");
  assert.ok(body.includes(`QA P5 partner call ${run}`), "With the call the partner logged in the portal");
  pass("The partner's customer shows its contact; the deal opens with the partner's call on it");

  step("03", "Working it: Add Product & Service");

  await page.getByRole("button", { name: /Add Product & Service/ }).click();
  const book = page.getByRole("combobox", { name: "Price book" });
  await book.click();
  await book.fill(`QA P5 Book ${run}`);
  await page.getByRole("option", { name: new RegExp(`QA P5 Book ${run}`) }).click();
  const line = page.getByRole("combobox", { name: "Line 1 product or service" });
  await line.click();
  await line.fill(`QA P5 Item ${run}`);
  await page.getByRole("option", { name: new RegExp(`QA P5 Item ${run}`) }).click();
  await page.getByText("Prices filled from the book.").first().waitFor({ timeout: 8000 });
  await page.getByRole("button", { name: "Save products & services" }).click();
  await page.getByRole("button", { name: /Edit products & services/ }).waitFor({ timeout: 30000 });
  const priced = await must(db.from("opportunity").select("amount").eq("id", ids.theirDeal).single(), "Re-read the deal");
  assert.equal(Number(priced.amount), 4000);
  pass("Priced the partner's deal from the book: 4000");

  step("04", "Lookups, and ours stays out of reach");

  await open(`/quotations/new`);
  await page.getByRole("button", { name: /Select a deal/ }).click();
  const search = page.getByRole("combobox");
  await search.fill(`QA P5 Their Deal ${run}`);
  await page.getByRole("option", { name: new RegExp(`QA P5 Their Deal ${run}`) }).waitFor({ timeout: 15000 });
  await search.fill(`QA P5 Our Deal ${run}`);
  await page.getByText(`Nothing matches "QA P5 Our Deal ${run}".`).waitFor({ timeout: 15000 });
  await page.goto(`${base}/opportunities/${ids.ourDeal}`, { waitUntil: "networkidle" });
  assert.ok(!(await page.locator("body").innerText()).includes(`QA P5 Our Deal ${run}`), "Our deal does not open for them");
  pass("The deal lookup finds the partner's deal and not ours; ours does not open");

  step("05", "Nothing threw");
  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");

  console.log(`\n${"═".repeat(64)}\n${passed.length} checks passed.\n${"═".repeat(64)}\n`);
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
  const deals = [ids.theirDeal, ids.ourDeal];
  const { data: records } = await db.from("partner_commission").select("id").in("opportunityId", deals);
  const recordIds = (records ?? []).map((r) => r.id);
  if (recordIds.length) await clean("commission history", () => db.from("audit_history").delete().in("entityId", recordIds));
  await clean("activities", () => db.from("activity").delete().in("relatedEntityId", deals));
  await clean("deal lines", () => db.from("opportunity_product").delete().in("opportunityId", deals));
  await clean("deals", () => db.from("opportunity").delete().in("id", deals));
  await clean("prices", () => db.from("price_book_entry").delete().eq("priceBookId", ids.book));
  await clean("price book", () => db.from("price_book").delete().eq("id", ids.book));
  await clean("item", () => db.from("product").delete().eq("id", ids.product));
  await clean("contact", () => db.from("contact").delete().eq("id", ids.theirContact));
  await clean("leads", () => db.from("lead").delete().in("id", [ids.theirLead, ids.ourLead]));
  await clean("accounts", () => db.from("account").delete().in("id", [ids.theirAccount, ids.ourAccount]));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [...deals, ids.theirLead, ids.ourLead]));
  await clean("partner login", () => db.from("app_user").delete().eq("id", ids.partnerLogin));
  await clean("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await clean("partner company", () => db.from("account").delete().eq("id", ids.partnerAccount));
  if (ids.seller) {
    await clean("salesperson", () => db.from("app_user").delete().eq("id", ids.seller));
    await db.auth.admin.deleteUser(ids.seller).catch(() => {});
  }
  await clean("role", () => db.from("security_role").delete().eq("id", ids.role));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
