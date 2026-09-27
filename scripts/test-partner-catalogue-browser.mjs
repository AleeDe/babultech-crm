// A partner's Products & Services in the portal, in a real browser.
//
// They see BabulTech's items read-only, with our prices, and never another
// partner's; they add and edit their own company's items with our product
// form; and they sell their own item on a deal, after which its type is
// locked as ours are.
//
// Everything created is removed afterwards.
//
// Usage: node scripts/test-partner-catalogue-browser.mjs http://localhost:3100
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
  partnerAccount: randomUUID(), rivalAccount: randomUUID(), partner: randomUUID(), person: randomUUID(),
  login: null, customer: randomUUID(), deal: randomUUID(),
  ours: randomUUID(), rivals: randomUUID(), book: randomUUID(), entry: randomUUID(), mine: null,
};
let browser;

try {
  step("00", "A partner, BabulTech's priced item, a rival's item, and a deal");

  const owner = await must(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  );
  await must(db.from("account").insert([
    { id: ids.partnerAccount, accountNumber: `QPCB-P-${run}`, name: `QA PCB Partner Co ${run}`, accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now() },
    { id: ids.rivalAccount, accountNumber: `QPCB-R-${run}`, name: `QA PCB Rival Co ${run}`, accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now() },
  ]), "Create the partner companies");
  await must(db.from("contact").insert({
    id: ids.person, accountId: ids.partnerAccount, firstName: "Portal", lastName: `Seller ${run}`,
    email: `qpcb-${tag}@example.com`, updatedAt: now(),
  }), "Create the partner's person");
  await must(db.from("partner").insert({
    id: ids.partner, partnerNumber: `QPCB-${run}`, displayName: `QA PCB Partner ${run}`, kind: "COMPANY",
    accountId: ids.partnerAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: owner.id, defaultCommissionPercent: 10, updatedAt: now(),
  }), "Create the partner");
  const role = await must(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const email = `qpcb-${tag}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.login = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.login, fullName: `QA Seller ${run}`, email, roleId: role.id, userType: "PARTNER",
    partnerId: ids.partner, contactId: ids.person, status: "ACTIVE", updatedAt: now(),
  }), "Create the login");
  await must(db.from("account").insert({
    id: ids.customer, accountNumber: `QPCB-C-${run}`, name: `QA PCB Customer ${run}`,
    accountType: "PROSPECT", ownerUserId: owner.id, sourcePartnerId: ids.partner, updatedAt: now(),
  }), "Create their customer");
  await must(db.from("opportunity").insert({
    id: ids.deal, opportunityNumber: `QPCB-D-${run}`, name: `QA PCB Deal ${run}`, accountId: ids.customer,
    ownerUserId: owner.id, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: "2026-12-31",
    sourcePartnerId: ids.partner, updatedAt: now(),
  }), "Create their deal");
  await must(db.from("product").insert([
    { id: ids.ours, productCode: "auto", name: `QA PCB Ours ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now() },
    { id: ids.rivals, productCode: "auto", name: `QA PCB Rivals ${run}`, productType: "PRODUCT", addInTask: false, active: true, ownerAccountId: ids.rivalAccount, updatedAt: now() },
  ]), "Create the items");
  await must(db.from("price_book").insert({
    id: ids.book, name: `QA PCB Book ${run}`, currencyCode: "PKR", active: true, updatedAt: now(),
  }), "Create a price book");
  await must(db.from("price_book_entry").insert({
    id: ids.entry, priceBookId: ids.book, productId: ids.ours, quantity: 1, rate: 1500, licenseCost: 0,
    maintenanceCost: 0, cloudCost: 0, aiCost: 0, active: true, updatedAt: now(),
  }), "Price our item");
  pass("Records ready");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  step("01", "BabulTech's items, read-only; never the rival's");

  await page.getByRole("link", { name: "Products & Services" }).first().click();
  await page.waitForURL(/\/portal\/catalogue$/);
  await page.goto(`${base}/portal/catalogue?search=${encodeURIComponent(`QA PCB`)}`, { waitUntil: "networkidle" });
  let body = await page.locator("body").innerText();
  assert.ok(body.includes(`QA PCB Ours ${run}`), "BabulTech's item is listed");
  assert.ok(!body.includes(`QA PCB Rivals ${run}`), "The rival's item is not");
  await page.getByRole("link", { name: `QA PCB Ours ${run}` }).click();
  await page.waitForURL(/\/portal\/catalogue\/[0-9a-f-]{36}$/);
  // The URL changes before the page arrives; wait for the page itself.
  await page.getByRole("heading", { name: `QA PCB Ours ${run}` }).waitFor({ timeout: 20000 });
  await page.getByText(`QA PCB Book ${run}`).waitFor({ timeout: 10000 });
  body = await page.locator("body").innerText();
  assert.ok(body.includes(`QA PCB Book ${run}`), "With its price book");
  assert.match(body, /1,500\.00/, "And its price there");
  assert.equal(await page.getByRole("link", { name: "Edit" }).count(), 0, "Ours cannot be edited");
  // The page streams, so a missing item answers "not found" in the page rather
  // than as a 404 status.
  await page.goto(`${base}/portal/catalogue/${ids.rivals}`, { waitUntil: "networkidle" });
  await page.getByText(/could not be found/i).waitFor({ timeout: 20000 });
  assert.ok(!(await page.locator("body").innerText()).includes(`QA PCB Rivals ${run}`),
    "The rival's item cannot be opened even by its address");
  pass("Our item shows with its price and no Edit; the rival's is neither listed nor reachable");

  step("02", "Their own item, with our product form");

  await page.goto(`${base}/portal/catalogue/new`, { waitUntil: "networkidle" });
  assert.equal(await page.getByText("Owner", { exact: true }).count(), 0, "No owner to choose - it is their company's");
  await page.locator('input[name="name"]').fill(`QA PCB Install ${run}`);
  await page.getByLabel(/Service/).check();
  await page.getByRole("checkbox", { name: /Add in Task/ }).check();
  await page.getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/portal\/catalogue\/[0-9a-f-]{36}$/, { timeout: 30000 });
  ids.mine = page.url().split("/").pop();
  const made = await must(db.from("product").select("ownerAccountId, productType, addInTask, productCode").eq("id", ids.mine).single(), "Read the new item");
  assert.equal(made.ownerAccountId, ids.partnerAccount, "Owned by the partner's company");
  assert.equal(made.productType, "SERVICE");
  assert.ok(made.addInTask, "Sold in hours");
  assert.match(made.productCode, /^S-/, "With a service code");
  await page.getByText("Your company's").waitFor({ timeout: 10000 });
  pass(`Created ${made.productCode}, a service sold in hours, owned by the partner's company`);

  await page.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/edit$/);
  await page.locator('input[name="name"]').fill(`QA PCB Installation ${run}`);
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(new RegExp(`/portal/catalogue/${ids.mine}$`), { timeout: 30000 });
  await page.getByRole("heading", { name: `QA PCB Installation ${run}` }).waitFor({ timeout: 20000 });
  pass("Renamed through its edit form");

  step("03", "Sold on a deal; then its type is locked");

  await page.goto(`${base}/portal/deals/${ids.deal}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Add Product & Service/ }).click();
  const book = page.getByRole("combobox", { name: "Price book" });
  await book.click();
  await book.fill(`QA PCB Book ${run}`);
  await page.getByRole("option", { name: new RegExp(`QA PCB Book ${run}`) }).click();
  const line = page.getByRole("combobox", { name: "Line 1 product or service" });
  await line.click();
  await line.fill(`QA PCB Installation ${run}`);
  await page.getByRole("option", { name: new RegExp(`QA PCB Installation ${run}`) }).click();
  await page.getByText("Not in this price book - enter its price.").waitFor({ timeout: 8000 });
  await page.getByLabel("Line 1 hours").fill("8");
  await page.getByLabel("Line 1 Rate per hour").fill("2000");
  await page.getByRole("button", { name: "Save products & services" }).click();
  await page.getByRole("button", { name: /Edit products & services/ }).waitFor({ timeout: 30000 });
  const priced = await must(db.from("opportunity").select("amount").eq("id", ids.deal).single(), "Re-read the deal");
  assert.equal(Number(priced.amount), 16000, "8 hours at 2000");
  await page.goto(`${base}/portal/catalogue/${ids.mine}/edit`, { waitUntil: "networkidle" });
  await page.getByText(/The type is locked/).waitFor({ timeout: 10000 });
  assert.ok(await page.getByLabel(/Product/).first().isDisabled(), "The type cannot be changed");
  pass("Their item priced the deal at 16000 (8 hours at 2000), and its type is now locked");

  step("04", "Nothing threw");
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
  const { data: records } = await db.from("partner_commission").select("id").eq("opportunityId", ids.deal);
  const recordIds = (records ?? []).map((r) => r.id);
  if (recordIds.length) await clean("commission history", () => db.from("audit_history").delete().in("entityId", recordIds));
  await clean("deal lines", () => db.from("opportunity_product").delete().eq("opportunityId", ids.deal));
  await clean("deal", () => db.from("opportunity").delete().eq("id", ids.deal));
  await clean("prices", () => db.from("price_book_entry").delete().eq("priceBookId", ids.book));
  await clean("price book", () => db.from("price_book").delete().eq("id", ids.book));
  const items = [ids.ours, ids.rivals, ids.mine].filter(Boolean);
  await clean("items", () => db.from("product").delete().in("id", items));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.deal, ...items]));
  if (ids.login) {
    await clean("login", () => db.from("app_user").delete().eq("id", ids.login));
    await db.auth.admin.deleteUser(ids.login).catch(() => {});
  }
  await clean("contact", () => db.from("contact").delete().eq("id", ids.person));
  await clean("customer", () => db.from("account").delete().eq("id", ids.customer));
  await clean("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await clean("partner companies", () => db.from("account").delete().in("id", [ids.partnerAccount, ids.rivalAccount]));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
