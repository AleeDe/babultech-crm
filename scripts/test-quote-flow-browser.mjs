// A quote, from the deal to its acceptance, through the real screens.
//
// The quote is priced exactly as its deal is, and accepting it puts its lines
// on the deal (20260928000003_quotes_priced_like_deals.sql). This checks that
// the screens do what that promises: New quote starts with everything the deal
// sells - costs, discount and all - every value can be changed, the quote's
// totals are the lines', and accepting it replaces the deal's lines, so the
// deal's value becomes what the customer accepted.
//
// Everything it creates is removed afterwards.
//
// Usage: node scripts/test-quote-flow-browser.mjs http://localhost:3100
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

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const run = randomUUID().slice(0, 6).toUpperCase();
const now = () => new Date().toISOString();
const passed = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
const step = (no, title) => { console.log(`\n${no}  ${title}`); console.log("─".repeat(64)); };
const money = (v) => Math.round(Number(v) * 100) / 100;
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = {
  role: randomUUID(), user: null, account: randomUUID(), contact: randomUUID(),
  training: randomUUID(), licence: randomUUID(), book: randomUUID(), opportunity: randomUUID(),
};
let browser;
const errors = [];

try {
  // ═══════════════════════════════════════════════════════════════════════
  step("00", "A deal priced from a book, with costs on it");
  // ═══════════════════════════════════════════════════════════════════════

  await must(db.from("security_role").insert({
    id: ids.role, name: `Quote QA ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now(),
  }), "Create the role");
  const password = randomBytes(24).toString("base64url");
  const email = `quote-qa-${run.toLowerCase()}@example.com`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.user, fullName: `Quote QA ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now(),
  }), "Create the user");

  await must(db.from("account").insert({
    id: ids.account, accountNumber: `QQA-${run}`, name: `QA Quote Customer ${run}`,
    accountType: "CUSTOMER", ownerUserId: ids.user, updatedAt: now(),
  }), "Create the customer");
  await must(db.from("contact").insert({
    id: ids.contact, accountId: ids.account, firstName: "Sana", lastName: `Buyer ${run}`,
    email: `quote-sana-${run.toLowerCase()}@example.com`, isPrimary: true, updatedAt: now(),
  }), "Create their contact");

  // Every row carries the same keys: a multi-row insert fills a missing one
  // with null, not its default.
  await must(db.from("product").insert([
    { id: ids.training, productCode: "auto", name: `QA Quote Training ${run}`, productType: "SERVICE", addInTask: true, active: true, updatedAt: now() },
    { id: ids.licence, productCode: "auto", name: `QA Quote Licence ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now() },
  ]), "Create the items");
  await must(db.from("price_book").insert({
    id: ids.book, name: `QA Quote Rates ${run}`, currencyCode: "PKR", active: true, validFrom: "2026-01-01", updatedAt: now(),
  }), "Create the book");
  const entries = await must(db.from("price_book_entry").insert([
    { priceBookId: ids.book, productId: ids.training, quantity: 20, rate: 5000, licenseCost: 0, maintenanceCost: 0, cloudCost: 0, aiCost: 0 },
    { priceBookId: ids.book, productId: ids.licence, quantity: 10, rate: 0, licenseCost: 50000, maintenanceCost: 0, cloudCost: 12000, aiCost: 0 },
  ]).select("id, productId"), "Price the items");
  const entryOf = Object.fromEntries(entries.map((e) => [e.productId, e.id]));

  await must(db.from("opportunity").insert({
    id: ids.opportunity, opportunityNumber: `QQO-${run}`, name: `QA Quote Rollout ${run}`,
    accountId: ids.account, primaryContactId: ids.contact, ownerUserId: ids.user, stage: "NEGOTIATION",
    amount: 0, currencyCode: "PKR", expectedCloseDate: "2026-12-31", opportunityType: "NEW", updatedAt: now(),
  }), "Create the deal");
  await must(db.from("opportunity_product").insert([
    {
      opportunityId: ids.opportunity, productId: ids.training, priceBookEntryId: entryOf[ids.training],
      quantity: 20, unitPrice: 5000, licenseCost: 0, maintenanceCost: 0, cloudCost: 0, aiCost: 0,
      discountPercent: 10, sortOrder: 1,
    },
    {
      opportunityId: ids.opportunity, productId: ids.licence, priceBookEntryId: entryOf[ids.licence],
      quantity: 10, unitPrice: 0, licenseCost: 50000, maintenanceCost: 0, cloudCost: 12000, aiCost: 0,
      discountPercent: 0, sortOrder: 2,
    },
  ]), "Price the deal");
  const priced = await must(db.from("opportunity").select("amount").eq("id", ids.opportunity).single(), "Read the deal");
  // 20 x 5,000 less 10% = 90,000; 50,000 + 12,000 = 62,000.
  assert.equal(money(priced.amount), 152000);
  pass("Deal: 20 h training less 10% (90,000) and a licence with licence and cloud costs (62,000) - 152,000");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  // ═══════════════════════════════════════════════════════════════════════
  step("01", "New quote starts with everything the deal sells");
  // ═══════════════════════════════════════════════════════════════════════

  // The quotations card is on the Details tab.
  await page.goto(`${base}/opportunities/${ids.opportunity}?tab=details`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "New quote" }).click();
  await page.waitForURL(/\/quotations\/new\?opportunityId=/, { timeout: 30000 });
  await page.getByText("Copied from the deal").waitFor({ timeout: 20000 });

  assert.equal(await page.getByLabel("Line 1 hours").inputValue(), "20", "The hours come from the deal");
  assert.equal(await page.getByLabel("Line 1 Rate per hour").inputValue(), "5000", "And the rate");
  assert.equal(await page.getByLabel("Line 1 discount percent").inputValue(), "10", "And the discount");
  assert.equal(await page.getByLabel("Line 2 License cost").inputValue(), "50000", "The licence cost comes across");
  assert.equal(await page.getByLabel("Line 2 Cloud cost").inputValue(), "12000", "And the cloud cost");
  assert.equal(
    await page.locator('input[name="contactId"]').inputValue(), ids.contact,
    "The deal's main contact is the quote's contact",
  );
  // The lookup names its record once it has asked the server, just after render.
  await page.getByText(`Sana Buyer ${run}`).first().waitFor({ timeout: 10000 });
  let body = await page.locator("body").innerText();
  await page.getByText(/Quote total\s+PKR\s152,000\.00/).first().waitFor({ timeout: 5000 });
  pass("Both lines copied with hours, rate, discount and the costs - 152,000, the deal's own figure");

  // ═══════════════════════════════════════════════════════════════════════
  step("02", "Every value can be changed for the quote");
  // ═══════════════════════════════════════════════════════════════════════

  // 24 h x 5,000 less 10% = 108,000; licence 50,000 + 12,000 + AI 5,000 = 67,000.
  await page.getByLabel("Line 1 hours").fill("24");
  await page.getByLabel("Line 2 AI cost").fill("5000");
  await page.getByLabel("Line 2 description").fill(`Licences for ten users - ${run}`);
  await page.getByText(/Quote total\s+PKR\s175,000\.00/).first().waitFor({ timeout: 5000 });
  pass("Hours changed to 24 and an AI cost added - the quote total moved to 175,000 as it was typed");

  await page.getByRole("button", { name: "Create quote" }).click();
  await page.waitForURL(/\/quotations\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const quoteId = page.url().split("/").pop();
  await page.getByText(/Where this quote is/).waitFor({ timeout: 20000 });
  body = await page.locator("body").innerText();
  assert.match(body, /PKR\s175,000\.00/, "The quote's total");
  assert.match(body, /PKR\s67,000\.00/, "And the licence line's costs, shown on the quote");
  assert.ok(body.includes(`Licences for ten users - ${run}`), "With the description as typed");

  const quote = await must(
    db.from("quotation").select("subtotal, discountAmount, taxAmount, totalAmount, priceBookId, status").eq("id", quoteId).single(),
    "Read the quote",
  );
  assert.equal(money(quote.subtotal), 187000, "Before discount: 120,000 + 67,000");
  assert.equal(money(quote.discountAmount), 12000, "The 10% off the training");
  assert.equal(money(quote.totalAmount), 175000);
  assert.equal(quote.priceBookId, ids.book, "Priced from the deal's book");
  pass("Saved as a draft: subtotal 187,000, discount 12,000, total 175,000 - worked out by the database");

  // ═══════════════════════════════════════════════════════════════════════
  step("03", "Sent, then accepted: the deal becomes the quote");
  // ═══════════════════════════════════════════════════════════════════════

  await page.getByRole("button", { name: "Mark as sent" }).click();
  await page.getByText(/Sent\. The deal has moved to Quote Submitted\./).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Accepted" }).waitFor({ timeout: 20000 });

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Accepted" }).click();
  await page.getByText(/The deal now carries this quote's products and services/).waitFor({ timeout: 30000 });

  const deal = await must(db.from("opportunity").select("amount, stage, priceBookId").eq("id", ids.opportunity).single(), "Re-read the deal");
  const lines = await must(
    db.from("opportunity_product").select("productId, quantity, aiCost, description").eq("opportunityId", ids.opportunity),
    "Re-read the deal's lines",
  );
  assert.equal(money(deal.amount), 175000, "The deal's value is the accepted quote's");
  assert.equal(deal.stage, "VERBAL_CONFIRMATION", "And it has moved on");
  assert.equal(lines.length, 2, "Two lines, the quote's");
  assert.equal(money(lines.find((l) => l.productId === ids.training).quantity), 24, "The 24 hours accepted");
  assert.equal(money(lines.find((l) => l.productId === ids.licence).aiCost), 5000, "And the AI cost");
  pass("Deal now 175,000 at Verbal Confirmation, with the accepted 24 hours and AI cost on its lines");

  await page.goto(`${base}/opportunities/${ids.opportunity}`, { waitUntil: "networkidle" });
  body = await page.locator("body").innerText();
  assert.match(body, /Deal total\s+PKR\s175,000\.00/, "Its products and services total the accepted quote");
  await page.goto(`${base}/opportunities/${ids.opportunity}?tab=details`, { waitUntil: "networkidle" });
  body = await page.locator("body").innerText();
  assert.match(body, /accepted - this deal can be won/i, "The deal says it can be won");
  assert.equal(await page.getByRole("link", { name: "New quote" }).count(), 0, "And no second quote is offered");
  pass("The deal page shows the accepted lines and total, and offers no second quote");

  // ═══════════════════════════════════════════════════════════════════════
  step("04", "Nothing threw");
  // ═══════════════════════════════════════════════════════════════════════

  assert.equal(
    errors.length, 0,
    `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`,
  );
  pass("No browser runtime errors");

  console.log(`\n${"═".repeat(64)}`);
  console.log(`${passed.length} checks passed.`);
  console.log(`${"═".repeat(64)}\n`);
} finally {
  if (browser) await browser.close().catch(() => {});

  // The deal takes its lines and quotes with it; the book takes its entries.
  const failures = [];
  const step = async (what, fn) => {
    const r = await fn();
    if (r?.error) failures.push(`${what}: ${r.error.message}`);
  };
  await step("deal", () => db.from("opportunity").delete().eq("id", ids.opportunity));
  await step("contact", () => db.from("contact").delete().eq("id", ids.contact));
  await step("account", () => db.from("account").delete().eq("id", ids.account));
  await step("book", () => db.from("price_book").delete().eq("id", ids.book));
  await step("items", () => db.from("product").delete().in("id", [ids.training, ids.licence]));
  if (ids.user) {
    await step("login", () => db.from("app_user").delete().eq("id", ids.user));
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
