// USD beside totals only, in a real browser.
//
// A deal, a quote and an invoice with known amounts. Their totals, the summary
// tiles above their lists and the dashboard's headline tiles carry the USD
// reference; their lines, the rows of the lists and the figures that are not
// totals show PKR alone.
//
// Everything created is removed afterwards.
//
// Usage: node scripts/test-usd-totals-browser.mjs http://localhost:3100
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
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = {
  role: randomUUID(), user: null, account: randomUUID(), product: randomUUID(), book: randomUUID(), entry: randomUUID(),
  deal: randomUUID(), quote: randomUUID(), invoice: randomUUID(),
};
let browser;

// A total: PKR, then the reference in USD. An ordinary amount: PKR with no
// reference after it. Tile labels are set in capitals, so case is ignored.
const TOTAL = (label, amount) => new RegExp(`${label}\\s+PKR\\s${amount} \\(≈ USD\\s`, "i");
const PLAIN = (label, amount) => new RegExp(`${label}\\s+PKR\\s${amount}(?! \\(≈)`, "i");

try {
  await must(db.from("security_role").insert({
    id: ids.role, name: `USD Totals QA ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now(),
  }), "Create the role");
  const email = `usd-totals-qa-${run.toLowerCase()}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.user, fullName: `USD Totals QA ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now(),
  }), "Create the user");

  await must(db.from("account").insert({
    id: ids.account, accountNumber: `QUSD-A-${run}`, name: `QA USD Customer ${run}`, accountType: "CUSTOMER",
    ownerUserId: ids.user, updatedAt: now(),
  }), "Create the customer");
  await must(db.from("product").insert({
    id: ids.product, productCode: "auto", name: `QA USD Item ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now(),
  }), "Create an item");
  await must(db.from("price_book").insert({
    id: ids.book, name: `QA USD Book ${run}`, currencyCode: "PKR", active: true, updatedAt: now(),
  }), "Create a price book");
  await must(db.from("price_book_entry").insert({
    id: ids.entry, priceBookId: ids.book, productId: ids.product, quantity: 1, rate: 1000, licenseCost: 0,
    maintenanceCost: 0, cloudCost: 0, aiCost: 0, active: true, updatedAt: now(),
  }), "Price it");
  await must(db.from("opportunity").insert({
    id: ids.deal, opportunityNumber: `QUSD-D-${run}`, name: `QA USD Deal ${run}`, accountId: ids.account,
    ownerUserId: ids.user, stage: "NEGOTIATION", amount: 0, currencyCode: "PKR", expectedCloseDate: day(30), updatedAt: now(),
  }), "Create a deal");
  await must(db.from("opportunity_product").insert({
    opportunityId: ids.deal, productId: ids.product, priceBookEntryId: ids.entry, quantity: 2, unitPrice: 1000,
    licenseCost: 0, maintenanceCost: 0, cloudCost: 0, aiCost: 0, discountPercent: 0, sortOrder: 1,
  }), "Put the item on it: 2 x 1,000");
  await must(db.from("quotation").insert({
    id: ids.quote, quoteNumber: `QUSD-Q-${run}`, opportunityId: ids.deal, accountId: ids.account, versionNumber: 1,
    status: "SENT", quoteDate: day(0), expiryDate: day(30), currencyCode: "PKR", priceBookId: ids.book, updatedAt: now(),
  }), "Create a quote");
  await must(db.from("quote_line").insert({
    quotationId: ids.quote, productId: ids.product, priceBookEntryId: ids.entry, description: "QA USD line",
    quantity: 2, unitPrice: 1000, sortOrder: 0,
  }), "Give it a line: 2 x 1,000");
  await must(db.from("invoice").insert({
    id: ids.invoice, invoiceNumber: `QUSD-I-${run}`, accountId: ids.account, invoiceDate: day(0), dueDate: day(30),
    status: "DRAFT", currencyCode: "PKR", subtotal: 1500, discountAmount: 0, taxAmount: 0, totalAmount: 1500,
    paidAmount: 0, outstandingAmount: 1500, updatedAt: now(),
  }), "Create an invoice");
  await must(db.from("invoice_line").insert({
    invoiceId: ids.invoice, description: "QA USD invoice line", quantity: 1, unitPrice: 1500, lineTotal: 1500, updatedAt: now(),
  }), "Give it a line");
  pass("Records ready: a 2,000 deal and quote, a 1,500 invoice");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  const open = async (path, waitFor) => {
    const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    assert.ok((res?.status() ?? 0) < 400, `${path} returned ${res?.status()}`);
    if (waitFor) await page.getByText(waitFor).first().waitFor({ timeout: 20000 });
    return page.locator("body").innerText();
  };
  const tableText = async (containing) =>
    page.locator("table", { hasText: containing }).first().innerText();

  // --- The deal ---------------------------------------------------------------
  let body = await open(`/opportunities/${ids.deal}`, `QA USD Deal ${run}`);
  assert.match(body, TOTAL("Deal value", "2,000\\.00"), "The deal's value is a total");
  assert.match(body, /Deal total\s*PKR\s2,000\.00\s*≈\s*USD/, "So is the total under its products");
  assert.match(body, /Weighted\s+PKR\s[\d,]+\.\d{2}(?!\s*\(≈)/i, "The weighted figure is not a total");
  const dealLines = await tableText(`QA USD Item ${run}`);
  assert.ok(!dealLines.includes("≈"), `The deal's lines show PKR only:\n${dealLines}`);
  pass("Deal: value and total carry USD; the lines and the weighted figure do not");

  // --- The quote --------------------------------------------------------------
  body = await open(`/quotations/${ids.quote}`, `QUSD-Q-${run}`);
  assert.match(body, TOTAL("Total", "2,000\\.00"), "The quote's total carries USD");
  assert.match(body, PLAIN("Subtotal", "2,000\\.00"), "Its subtotal does not");
  const quoteLines = await tableText("QA USD line");
  assert.ok(!quoteLines.includes("≈"), `The quote's lines show PKR only:\n${quoteLines}`);
  pass("Quote: the total carries USD; the subtotal and lines do not");

  // --- The invoice ------------------------------------------------------------
  body = await open(`/invoices/${ids.invoice}`, `QUSD-I-${run}`);
  assert.match(body, TOTAL("Total", "1,500\\.00"), "The invoice's total carries USD");
  assert.match(body, TOTAL("Outstanding", "1,500\\.00"), "And what is still owed on it");
  assert.match(body, PLAIN("Paid", "0\\.00"), "What has been paid does not");
  const invoiceLines = await tableText("QA USD invoice line");
  assert.ok(!invoiceLines.includes("≈"), `The invoice's lines show PKR only:\n${invoiceLines}`);
  pass("Invoice: total and outstanding carry USD; paid and the lines do not");

  // --- The lists --------------------------------------------------------------
  body = await open(`/invoices`, `QUSD-I-${run}`);
  assert.match(body, /Outstanding\s+PKR\s[\d,]+\.\d{2} \(≈ USD/i, "The invoice list's summary tiles carry USD");
  let row = await page.locator("tr", { hasText: `QUSD-I-${run}` }).first().innerText();
  assert.ok(!row.includes("≈"), `An invoice's row shows PKR only: ${row}`);
  body = await open(`/opportunities`, `QA USD Deal ${run}`);
  assert.match(body, /Open pipeline\s+PKR\s[\d.,]+[KMB]? \(≈ USD/i, "The deal list's summary tiles carry USD");
  row = await page.locator("tr", { hasText: `QA USD Deal ${run}` }).first().innerText();
  assert.ok(!row.includes("≈"), `A deal's row shows PKR only: ${row}`);
  pass("Lists: the summary tiles carry USD; the rows do not");

  // --- The dashboard ----------------------------------------------------------
  await open(`/`, "Open pipeline");
  // The headline tiles count up to their figure; give them a moment to land.
  await page.waitForTimeout(2500);
  body = await page.locator("body").innerText();
  assert.match(body, /Open pipeline\s+PKR\s[\d.,]+[KMB]? \(≈ USD/i, "The dashboard's Open pipeline tile carries USD");
  pass("Dashboard: the headline tiles carry USD");

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
  await clean("invoice lines", () => db.from("invoice_line").delete().eq("invoiceId", ids.invoice));
  await clean("invoice", () => db.from("invoice").delete().eq("id", ids.invoice));
  await clean("quote lines", () => db.from("quote_line").delete().eq("quotationId", ids.quote));
  await clean("quote", () => db.from("quotation").delete().eq("id", ids.quote));
  await clean("deal lines", () => db.from("opportunity_product").delete().eq("opportunityId", ids.deal));
  await clean("deal", () => db.from("opportunity").delete().eq("id", ids.deal));
  await clean("prices", () => db.from("price_book_entry").delete().eq("priceBookId", ids.book));
  await clean("price book", () => db.from("price_book").delete().eq("id", ids.book));
  await clean("item", () => db.from("product").delete().eq("id", ids.product));
  await clean("customer", () => db.from("account").delete().eq("id", ids.account));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.deal, ids.quote, ids.invoice, ids.account]));
  if (ids.user) {
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
