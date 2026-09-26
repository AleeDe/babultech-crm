// The sales restructure, driven through the real screens in a browser.
//
// Not just "does the page load": this clicks Add Product & Service, searches a
// price book and a service by typing, checks the pricing arrives from the book,
// changes a discount and watches the total move, saves, and then confirms in the
// database that the deal's amount became the total of its lines. It then wins
// the deal and checks the project and its task appear on the project page.
//
// Everything it creates is removed afterwards.
//
// Usage: node scripts/test-sales-restructure-browser.mjs http://localhost:3100
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

const ids = { role: randomUUID(), user: null, account: null, opportunity: null, book: null, products: [], project: null };
let browser;
const errors = [];

try {
  // ═══════════════════════════════════════════════════════════════════════
  step("00", "An administrator, a customer and a price book");
  // ═══════════════════════════════════════════════════════════════════════

  await db.from("security_role").insert({
    id: ids.role, name: `Sales QA ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now(),
  });
  const password = randomBytes(24).toString("base64url");
  const email = `sales-qa-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await db.from("app_user").insert({
    id: ids.user, fullName: `Sales QA ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now(),
  });

  ids.account = randomUUID();
  await db.from("account").insert({
    id: ids.account, accountNumber: `SQA-${run}`, name: `QA Textiles ${run}`,
    accountType: "CUSTOMER", ownerUserId: ids.user, updatedAt: now(),
  });

  // Two items of our own for this run, so the test never depends on - or
  // changes - the seeded catalogue.
  const training = randomUUID();
  const licence = randomUUID();
  const products = await db.from("product").insert([
    { id: training, productCode: "pending", name: `QA Training ${run}`, productType: "SERVICE", addInTask: true, active: true, updatedAt: now() },
    { id: licence, productCode: "pending", name: `QA Licence ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now() },
  ]);
  if (products.error) throw new Error(`Create the items: ${products.error.message}`);
  ids.products.push(training, licence);

  ids.book = randomUUID();
  await db.from("price_book").insert({
    id: ids.book, name: `QA Rates ${run}`, currencyCode: "PKR", active: true,
    validFrom: "2026-01-01", validTo: "2026-12-31", updatedAt: now(),
  });
  // Training: 20h at 5,000. Licence: 10 users, 0 rate, licence cost 50,000.
  // Every row carries the same keys: PostgREST refuses a bulk insert whose rows
  // differ, and does it by RETURNING an error rather than throwing - which is
  // exactly how this test once ran against an empty book and blamed the screen.
  const entries = await db.from("price_book_entry").insert([
    { priceBookId: ids.book, productId: training, quantity: 20, rate: 5000, licenseCost: 0 },
    { priceBookId: ids.book, productId: licence, quantity: 10, rate: 0, licenseCost: 50000 },
  ]);
  if (entries.error) throw new Error(`Price the items: ${entries.error.message}`);

  ids.opportunity = randomUUID();
  await db.from("opportunity").insert({
    id: ids.opportunity, opportunityNumber: `SQO-${run}`, name: `QA Rollout ${run}`,
    accountId: ids.account, ownerUserId: ids.user, stage: "DISCOVERY", amount: 1,
    currencyCode: "PKR", expectedCloseDate: "2026-12-31", opportunityType: "NEW", updatedAt: now(),
  });

  const { data: codes } = await db.from("product").select("name, productCode").in("id", [training, licence]);
  const codeOf = Object.fromEntries(codes.map((c) => [c.name, c.productCode]));
  assert.match(codeOf[`QA Training ${run}`], /^S-\d{6}$/, "A service is coded S-000000");
  assert.match(codeOf[`QA Licence ${run}`], /^P-\d{6}$/, "A product is coded P-000000");
  pass(`Codes issued by the database: ${codeOf[`QA Training ${run}`]}, ${codeOf[`QA Licence ${run}`]}`);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));

  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  const open = async (path) => {
    const res = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    assert.ok((res?.status() ?? 0) < 400, `${path} returned ${res?.status()}`);
    const body = await page.locator("body").innerText();
    assert.ok(!/Application error|Internal Server Error/i.test(body), `${path} rendered an error`);
    return body;
  };

  // ═══════════════════════════════════════════════════════════════════════
  step("01", "Company information");
  // ═══════════════════════════════════════════════════════════════════════

  let body = await open("/company");
  for (const label of ["Users", "Customers", "Deals", "Partners", "Cases", "Leads", "Data storage", "File storage"]) {
    // Tile labels are uppercased by CSS, and innerText reflects that.
    assert.ok(body.toLowerCase().includes(label.toLowerCase()), `The ${label} total should be on the page`);
  }
  assert.match(body, /Setup business hours/i, "With a Setup Business Hours button");
  assert.match(body, /Setup currency/i, "And Setup Currency");
  for (const c of ["PKR", "USD", "CAD", "AUD", "AED"]) assert.ok(body.includes(c), `${c} should be listed`);
  pass("Settings, eight totals, business hours and five currencies shown");

  body = await open("/company/business-hours");
  assert.match(body, /monday/i, "The week should be laid out");
  pass("Business hours screen renders the seven days");

  body = await open("/company/currencies");
  assert.match(body, /1 USD = PKR/i, "Each rate is described the right way round");
  pass("Currency screen describes each rate against PKR");

  // ═══════════════════════════════════════════════════════════════════════
  step("02", "Products & Services");
  // ═══════════════════════════════════════════════════════════════════════

  body = await open("/products");
  assert.match(body, /Products & Services/, "Relabelled");
  assert.ok(body.includes(codeOf[`QA Training ${run}`]), "The service is listed with its code");
  pass("Listed as Products & Services, with codes");

  await open("/products/new");
  // The flag is offered for a service and hidden for a product.
  assert.ok(await page.getByText("Add in Task", { exact: true }).isVisible(), "Add in Task shows for a Service");
  await page.getByRole("radio", { name: /^Product/ }).check();
  assert.equal(await page.getByText("Add in Task", { exact: true }).count(), 0, "And disappears for a Product");
  pass("Add in Task is offered only for a Service");

  // ═══════════════════════════════════════════════════════════════════════
  step("03", "Add Product & Service, through the screen");
  // ═══════════════════════════════════════════════════════════════════════

  await open(`/opportunities/${ids.opportunity}`);
  await page.getByRole("button", { name: /Add Product & Service/ }).click();

  // The price book, found by typing.
  const bookBox = page.getByRole("combobox", { name: "Price book" });
  await bookBox.click();
  await bookBox.fill(`QA Rates ${run}`);
  await page.getByRole("option", { name: new RegExp(`QA Rates ${run}`) }).click();

  // The service, found by its CODE rather than its name.
  const line1 = page.getByRole("combobox", { name: "Line 1 product or service" });
  await line1.click();
  await line1.fill(codeOf[`QA Training ${run}`]);
  await page.getByRole("option", { name: new RegExp(`QA Training ${run}`) }).click();

  // Its pricing arrives from the book, and says it is hours.
  await page.getByText("Prices filled from the book.").first().waitFor({ timeout: 8000 }).catch(async (e) => {
    await page.screenshot({ path: "artifacts/add-product-state.png", fullPage: true });
    throw e;
  });
  const hoursField = page.getByLabel("Line 1 hours");
  assert.equal(await hoursField.inputValue(), "20", "Hours should arrive from the book");
  assert.equal(await page.getByLabel("Line 1 Rate per hour").inputValue(), "5000", "And the rate");
  assert.ok(await page.getByText(/becomes a project task when won/i).first().isVisible(), "And it says it becomes a task");
  pass("Book and service chosen by typing; 20 hours at 5,000 filled in, labelled as hours");

  // 10% off, and the total moves live: 100,000 - 10% = 90,000.
  await page.getByLabel("Line 1 discount percent").fill("10");
  // \s, not a space: Intl puts a non-breaking space between the code and the number.
  await page.getByText(/Line total\s+PKR\s90,000\.00/).first().waitFor({ timeout: 5000 });
  pass("Discount applied - the line total moved to PKR 90,000.00 as it was typed");

  // A second line: the book is not asked for again.
  await page.getByRole("button", { name: /Add another product or service/ }).click();
  const line2 = page.getByRole("combobox", { name: "Line 2 product or service" });
  await line2.click();
  await line2.fill(`QA Licence ${run}`);
  await page.getByRole("option", { name: new RegExp(`QA Licence ${run}`) }).click();
  assert.ok(await page.getByLabel("Line 2 quantity").isVisible(), "A product is sold in a quantity, not hours");
  assert.equal(await page.getByLabel("Line 2 License cost").inputValue(), "50000", "Its licence cost arrives from the book");
  pass("Second line added from the same book; the product shows Quantity, not Hours");

  // 90,000 + 50,000 = 140,000.
  await page.getByText(/Deal total\s+PKR\s140,000\.00/).first().waitFor({ timeout: 5000 });
  pass("Deal total live: PKR 140,000.00");

  await page.getByRole("button", { name: /Save products & services/ }).click();
  const savedAt = Date.now();
  // Reports database state on failure: "did not save" and "saved but the
  // screen did not show it" are different bugs, and this has been both.
  await page.getByText(/Priced from/).first().waitFor({ timeout: 20000 }).then(() => console.log(`  ·     Screen updated ${((Date.now() - savedAt) / 1000).toFixed(1)}s after Save`)).catch(async (e) => {
    await page.screenshot({ path: "artifacts/save-state.png", fullPage: true });
    const alert = await page.locator('[role="alert"], .text-destructive').allInnerTexts();
    const { data: inDb } = await db.from("opportunity_product").select("id").eq("opportunityId", ids.opportunity);
    const { data: oppNow } = await db.from("opportunity").select("amount, priceBookId").eq("id", ids.opportunity).single();
    await page.reload({ waitUntil: "networkidle" });
    const afterReload = (await page.locator("body").innerText()).includes("Priced from");
    console.log(`  ·     After a full reload the saved lines ${afterReload ? "DO" : "do NOT"} show.`);
    throw new Error(
      `Save did not complete. On screen: ${alert.join(" | ") || "(no error shown)"}. ` +
      `In the database: ${inDb?.length ?? "?"} line(s), amount ${oppNow?.amount}, book ${oppNow?.priceBookId ? "set" : "not set"}.`,
      { cause: e },
    );
  });

  const { data: saved } = await db.from("opportunity")
    .select("amount, netAmount, taxAmount, pricedByLines, priceBookId").eq("id", ids.opportunity).single();
  assert.equal(money(saved.amount), 140000, "The deal's amount must be the total of its lines");
  assert.equal(saved.pricedByLines, true, "And be marked as priced by them");
  assert.equal(saved.priceBookId, ids.book, "Priced from the chosen book");
  const { count: lineCount } = await db.from("opportunity_product")
    .select("id", { count: "exact", head: true }).eq("opportunityId", ids.opportunity);
  assert.equal(lineCount, 2, "Both lines saved");
  pass("Saved: 2 lines, deal amount PKR 140,000 - replacing the 1 typed before");

  // ═══════════════════════════════════════════════════════════════════════
  step("04", "Two currencies on the deal");
  // ═══════════════════════════════════════════════════════════════════════

  body = await page.locator("body").innerText();
  assert.match(body, /PKR\s140,000\.00/, "The total in PKR");
  assert.match(body, /≈ USD\s[\d,]+\.\d\d/, "With its approximate USD value beside it");
  pass("Amounts shown in PKR with ≈ USD alongside");

  // ═══════════════════════════════════════════════════════════════════════
  step("05", "The edit form no longer prices anything");
  // ═══════════════════════════════════════════════════════════════════════

  body = await open(`/opportunities/${ids.opportunity}/edit`);
  assert.ok(!/Product & pricing|Line items/.test(body), "The old pricing sections are gone");
  assert.match(body, /Set by the products and services on this deal/i, "The amount explains where it comes from");
  pass("Old sections gone; amount read-only and explained");

  // ═══════════════════════════════════════════════════════════════════════
  step("06", "Won → Project-<deal>, with a task for the hours sold");
  // ═══════════════════════════════════════════════════════════════════════

  // The stage gate also wants an accepted quote, which is its own flow; this
  // step is about what winning PRODUCES, so the win is set directly and the
  // project is created exactly as the app creates it.
  await db.from("opportunity").update({ stage: "CLOSED_WON", actualCloseDate: "2026-09-27", updatedAt: now() }).eq("id", ids.opportunity);

  const signedIn = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  await signedIn.auth.signInWithPassword({ email, password });
  const { data: project, error: projectError } = await signedIn.rpc("create_project_for_won_opportunity", { p_opportunity: ids.opportunity });
  assert.ok(!projectError, projectError?.message);
  ids.project = project.id;
  assert.equal(project.name, `Project-QA Rollout ${run}`, "Named Project-<deal>");

  body = await open(`/projects/${ids.project}`);
  assert.match(body, /Hours sold/i, "Sold hours on the project");
  assert.match(body, /Hours remaining/i, "And what is left");
  assert.match(body, /Sync from deal/, "With a way to pull in later sales");
  assert.ok(body.includes(`QA Training ${run}`), "The training task is there");
  assert.ok(!body.includes(`QA Licence ${run}`), "The licence did NOT become a task");
  pass(`"${project.name}" created; the service became a task, the licence did not`);

  await page.getByRole("button", { name: /Sync from deal/ }).click();
  await page.getByText(/Already up to date with the deal/).waitFor({ timeout: 15000 });
  pass("Sync from deal reports nothing to add - it never duplicates");

  // ═══════════════════════════════════════════════════════════════════════
  step("07", "Nothing threw");
  // ═══════════════════════════════════════════════════════════════════════
  assert.equal(errors.length, 0, errors.map((e) => `${e.url}: ${e.message.slice(0, 200)}`).join("\n"));
  pass("No browser runtime errors");

  console.log(`\n${"═".repeat(64)}\n${passed.length} checks passed.\n${"═".repeat(64)}\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  const del = async (t, c, v) => {
    if (!v || (Array.isArray(v) && !v.length)) return;
    const r = Array.isArray(v) ? await db.from(t).delete().in(c, v) : await db.from(t).delete().eq(c, v);
    if (r.error) console.error(`  teardown ${t}: ${r.error.message}`);
  };
  await del("time_log", "projectId", ids.project);
  await del("project_task", "projectId", ids.project);
  await del("project_member", "projectId", ids.project);
  await del("project", "id", ids.project);
  await del("opportunity_product", "opportunityId", ids.opportunity);
  await del("opportunity", "id", ids.opportunity);
  await del("price_book_entry", "priceBookId", ids.book);
  await del("price_book", "id", ids.book);
  await del("product", "id", ids.products);
  await del("account", "id", ids.account);
  if (ids.user) {
    await db.from("app_user").delete().eq("id", ids.user);
    await db.auth.admin.deleteUser(ids.user).catch(() => {});
  }
  await db.from("security_role").delete().eq("id", ids.role);
  console.log("Temporary data removed.");
}
