// A partner pricing a deal and quoting it through the portal, with one of our
// approvers sending the quote back and then approving it, in a real browser.
//
// scripts/test-partner-quotes.mjs proves the database refuses what it should;
// this checks the screens: Add Product & Service in the portal offers only
// what the partner may sell, a quote starts from the deal, it waits for
// approval, our approver sees it in Approvals and decides on our quote page,
// the partner reads why it came back, and once accepted the deal is fixed and
// can be won.
//
// Nothing is emailed: the quote is marked as sent. Everything created is
// removed afterwards.
//
// Usage: node scripts/test-partner-quotes-browser.mjs http://localhost:3100
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
  role: randomUUID(), logins: [],
  customer: randomUUID(), contact: randomUUID(), deal: randomUUID(),
  ours: randomUUID(), mine: randomUUID(), rivals: randomUUID(), book: randomUUID(), entry: randomUUID(),
  quote: null,
};
let browser;

async function makeLogin(email, fields) {
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.logins.push(auth.data.user.id);
  await must(db.from("app_user").insert({
    id: auth.data.user.id, email, status: "ACTIVE", updatedAt: now(), ...fields,
  }), `Create the login for ${fields.fullName}`);
  return { email, password };
}

async function signedIn(login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(login.email);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  return page;
}

async function pick(page, box, text) {
  const combo = page.getByRole("combobox", { name: box });
  await combo.click();
  await combo.fill(text);
  await page.getByRole("option", { name: new RegExp(text) }).click();
}

try {
  step("00", "A partner, their customer and deal, what they may sell, and one of our approvers");

  const owner = await must(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  );
  await must(db.from("account").insert([
    { id: ids.partnerAccount, accountNumber: `QPQB-P-${run}`, name: `QA PQB Partner Co ${run}`, accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now() },
    { id: ids.rivalAccount, accountNumber: `QPQB-R-${run}`, name: `QA PQB Rival Co ${run}`, accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now() },
  ]), "Create the partner companies");
  await must(db.from("contact").insert({
    id: ids.person, accountId: ids.partnerAccount, firstName: "Portal", lastName: `Quoter ${run}`,
    email: `qpqb-${tag}@example.com`, updatedAt: now(),
  }), "Create the partner's person");
  await must(db.from("partner").insert({
    id: ids.partner, partnerNumber: `QPQB-${run}`, displayName: `QA PQB Partner ${run}`, kind: "COMPANY",
    accountId: ids.partnerAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: owner.id, defaultCommissionPercent: 10, updatedAt: now(),
  }), "Create the partner");
  const partnerRole = await must(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const partnerLogin = await makeLogin(`qpqb-${tag}@example.com`, {
    fullName: `QA Quoter ${run}`, roleId: partnerRole.id, userType: "PARTNER", portalRole: "ADMIN", partnerId: ids.partner, contactId: ids.person,
  });
  await must(db.from("security_role").insert({
    id: ids.role, name: `QA PQB Approver ${run}`, dataScope: "ALL", updatedAt: now(),
    permissions: ["quotation:approve", "opportunity:*", "account:read", "contact:read"],
  }), "Create the approver role");
  const approverLogin = await makeLogin(`qpqb-approver-${tag}@example.com`, {
    fullName: `QA PQB Approver ${run}`, roleId: ids.role, userType: "INTERNAL",
  });

  await must(db.from("account").insert({
    id: ids.customer, accountNumber: `QPQB-C-${run}`, name: `QA PQB Customer ${run}`,
    accountType: "PROSPECT", ownerUserId: owner.id, sourcePartnerId: ids.partner, updatedAt: now(),
  }), "Create their customer");
  await must(db.from("contact").insert({
    id: ids.contact, accountId: ids.customer, firstName: "Hamid", lastName: `Buyer ${run}`,
    email: `qpqb-hamid-${tag}@example.com`, isPrimary: true, sourcePartnerId: ids.partner, updatedAt: now(),
  }), "Create their contact");
  await must(db.from("opportunity").insert({
    id: ids.deal, opportunityNumber: `QPQB-D-${run}`, name: `QA PQB Rollout ${run}`, accountId: ids.customer,
    ownerUserId: owner.id, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: "2026-12-31",
    primaryContactId: ids.contact, sourcePartnerId: ids.partner, updatedAt: now(),
  }), "Create their deal");
  await must(db.from("product").insert([
    { id: ids.ours, productCode: "auto", name: `QA PQB Ours ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now() },
    { id: ids.mine, productCode: "auto", name: `QA PQB Mine ${run}`, productType: "PRODUCT", addInTask: false, active: true, ownerAccountId: ids.partnerAccount, updatedAt: now() },
    { id: ids.rivals, productCode: "auto", name: `QA PQB Rivals ${run}`, productType: "PRODUCT", addInTask: false, active: true, ownerAccountId: ids.rivalAccount, updatedAt: now() },
  ]), "Create the items");
  await must(db.from("price_book").insert({
    id: ids.book, name: `QA PQB Book ${run}`, currencyCode: "PKR", active: true, updatedAt: now(),
  }), "Create a price book");
  await must(db.from("price_book_entry").insert({
    id: ids.entry, priceBookId: ids.book, productId: ids.ours, quantity: 1, rate: 1000, licenseCost: 100,
    maintenanceCost: 0, cloudCost: 0, aiCost: 0, active: true, updatedAt: now(),
  }), "Price our item");
  pass("Records ready");

  browser = await chromium.launch({ headless: true });
  const partner = await signedIn(partnerLogin);

  step("01", "Add Product & Service in the portal");

  await partner.goto(`${base}/portal/deals/${ids.deal}`, { waitUntil: "networkidle" });
  await partner.getByRole("button", { name: /Add Product & Service/ }).click();
  await pick(partner, "Price book", `QA PQB Book ${run}`);
  await pick(partner, "Line 1 product or service", `QA PQB Ours ${run}`);
  await partner.getByText("Prices filled from the book.").first().waitFor({ timeout: 8000 });
  assert.equal(await partner.getByLabel("Line 1 License cost").inputValue(), "100", "The licence cost arrives from the book");
  await partner.getByLabel("Line 1 quantity").fill("2");
  await partner.getByLabel("Line 1 discount percent").fill("10");
  await partner.getByRole("button", { name: "Add another product or service" }).click();
  const line2 = partner.getByRole("combobox", { name: "Line 2 product or service" });
  await line2.click();
  await line2.fill(`QA PQB Rivals ${run}`);
  assert.equal(await partner.getByRole("option", { name: new RegExp(`QA PQB Rivals ${run}`) }).count(), 0,
    "Another partner's item is never offered");
  await line2.fill(`QA PQB Mine ${run}`);
  await partner.getByRole("option", { name: new RegExp(`QA PQB Mine ${run}`) }).click();
  await partner.getByLabel("Line 2 Unit price").fill("500");
  await partner.getByRole("button", { name: "Save products & services" }).click();
  await partner.getByRole("button", { name: /Edit products & services/ }).waitFor({ timeout: 30000 });
  const priced = await must(db.from("opportunity").select("amount").eq("id", ids.deal).single(), "Re-read the deal");
  assert.equal(Number(priced.amount), 2390, "2 x 1000 + 100, less 10%, + 500");
  pass("Priced from the book with their own item beside ours - the rival's is not offered; the deal is 2390");

  step("02", "A quote, starting from the deal");

  await partner.getByRole("link", { name: "New quote" }).click();
  await partner.waitForURL(/\/quotes\/new$/);
  assert.equal(await partner.getByLabel("Line 1 quantity").inputValue(), "2", "The quantity comes from the deal");
  assert.equal(await partner.getByLabel("Line 1 discount percent").inputValue(), "10", "And the discount");
  assert.equal(await partner.getByLabel("Contact").inputValue(), ids.contact, "Addressed to the deal's main contact");
  await partner.getByRole("button", { name: "Create quote" }).click();
  await partner.waitForURL(/\/portal\/quotes\/[0-9a-f-]{36}$/, { timeout: 30000 });
  ids.quote = partner.url().split("/").pop();
  const { quoteNumber } = await must(db.from("quotation").select("quoteNumber").eq("id", ids.quote).single(), "Read the quote");
  await partner.getByRole("button", { name: "Ask for approval" }).waitFor({ timeout: 20000 });
  assert.equal(await partner.getByRole("button", { name: "Mark as sent" }).count(), 0, "It cannot be sent before approval");
  pass(`${quoteNumber} created from the deal as a draft; it offers approval, not sending`);

  step("03", "Asking for approval");

  await partner.getByRole("button", { name: "Ask for approval" }).click();
  await partner.getByText(/Sent for approval/).waitFor({ timeout: 30000 });
  await partner.getByRole("button", { name: "Withdraw the request to change it" }).waitFor({ timeout: 10000 });
  pass("Waiting for approval, with a way to withdraw it");

  step("04", "Our approver finds it and sends it back");

  const approver = await signedIn(approverLogin);
  await approver.goto(`${base}/approvals`, { waitUntil: "networkidle" });
  let body = await approver.locator("body").innerText();
  assert.ok(body.includes(quoteNumber), "The quote is in the approvals queue");
  assert.ok(body.includes(`QA PQB Partner ${run}`), "Saying which partner asked");
  await approver.goto(`${base}/quotations/${ids.quote}`, { waitUntil: "networkidle" });
  body = await approver.locator("body").innerText();
  assert.match(body, new RegExp(`Prepared by\\s+QA PQB Partner ${run}`), "Our quote page names the partner");
  assert.equal(await approver.getByRole("button", { name: "Mark as sent" }).count(), 0, "Nobody can send it unapproved");
  await approver.getByRole("button", { name: "Send back to the partner" }).click();
  await approver.getByLabel("Why it is being sent back").fill(`Keep the discount to 5% ${run}`);
  await approver.getByRole("button", { name: "Send back", exact: true }).click();
  await approver.getByText("Sent back to the partner with your reason.").waitFor({ timeout: 30000 });
  pass("In Approvals under the partner's name; sent back with a reason from our quote page");

  step("05", "The partner reads why, changes it, and asks again");

  await partner.reload({ waitUntil: "networkidle" });
  await partner.getByText(`Sent back by your partner manager: Keep the discount to 5% ${run}`).waitFor({ timeout: 20000 });
  await partner.getByRole("link", { name: "Edit" }).click();
  await partner.waitForURL(/\/edit$/);
  await partner.getByLabel("Line 1 discount percent").fill("5");
  await partner.getByRole("button", { name: "Save quote" }).click();
  await partner.waitForURL(new RegExp(`/portal/quotes/${ids.quote}$`), { timeout: 30000 });
  const changed = await must(db.from("quotation").select("totalAmount, approvalStatus").eq("id", ids.quote).single(), "Re-read the quote");
  assert.equal(Number(changed.totalAmount), 2495, "2 x 1000 + 100, less 5%, + 500");
  await partner.getByRole("button", { name: "Ask for approval" }).click();
  await partner.getByText(/Sent for approval/).waitFor({ timeout: 30000 });
  pass("The reason shows in the portal; the discount is changed to 5% (2495) and approval asked again");

  step("06", "Approved");

  await approver.reload({ waitUntil: "networkidle" });
  await approver.getByRole("button", { name: "Approve" }).click();
  await approver.getByText("Approved. The partner can now send it to the customer.").waitFor({ timeout: 30000 });
  pass("Approved on our quote page");

  step("07", "Sent, accepted, and the deal won on it");

  await partner.reload({ waitUntil: "networkidle" });
  await partner.getByRole("button", { name: "Mark as sent" }).click();
  await partner.getByText(/Marked as sent/).waitFor({ timeout: 30000 });
  partner.once("dialog", (d) => d.accept());
  await partner.getByRole("button", { name: "Accepted" }).click();
  await partner.getByText(/Accepted\. The deal now carries this quote/).waitFor({ timeout: 30000 });
  await partner.goto(`${base}/portal/deals/${ids.deal}`, { waitUntil: "networkidle" });
  await partner.getByText(`The customer accepted ${quoteNumber}, so the deal is priced as that quote.`).waitFor({ timeout: 20000 });
  assert.equal(await partner.getByRole("button", { name: /Edit products & services/ }).count(), 0,
    "What was sold can no longer be changed from the portal");
  await partner.getByLabel("Stage").selectOption("CLOSED_WON");
  await partner.getByRole("button", { name: "Move" }).click();
  await partner.getByText(/Won\. Delivery project PRJ-\d{4}-\d+ has been started/).waitFor({ timeout: 30000 });
  const wonDeal = await must(db.from("opportunity").select("amount, stage").eq("id", ids.deal).single(), "Re-read the deal");
  assert.equal(Number(wonDeal.amount), 2495);
  assert.equal(wonDeal.stage, "CLOSED_WON");
  pass("Marked as sent, acceptance recorded, the lines locked, and the deal won on 2495");

  step("08", "Nothing threw");
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
  const { data: projects } = await db.from("project").select("id").eq("opportunityId", ids.deal);
  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length) {
    await clean("tasks", () => db.from("project_task").delete().in("projectId", projectIds));
    await clean("members", () => db.from("project_member").delete().in("projectId", projectIds));
    await clean("projects", () => db.from("project").delete().in("id", projectIds));
  }
  const { data: quotes } = await db.from("quotation").select("id").eq("opportunityId", ids.deal);
  const quoteIds = (quotes ?? []).map((q) => q.id);
  if (quoteIds.length) {
    await clean("quote lines", () => db.from("quote_line").delete().in("quotationId", quoteIds));
    await clean("quotes", () => db.from("quotation").delete().in("id", quoteIds));
  }
  for (const id of ids.logins) await clean("activities", () => db.from("activity").delete().eq("ownerUserId", id));
  await clean("deal lines", () => db.from("opportunity_product").delete().eq("opportunityId", ids.deal));
  await clean("deal", () => db.from("opportunity").delete().eq("id", ids.deal));
  await clean("prices", () => db.from("price_book_entry").delete().eq("priceBookId", ids.book));
  await clean("price book", () => db.from("price_book").delete().eq("id", ids.book));
  await clean("items", () => db.from("product").delete().in("id", [ids.ours, ids.mine, ids.rivals]));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.deal, ...quoteIds, ids.customer]));
  for (const id of ids.logins) {
    await clean("login", () => db.from("app_user").delete().eq("id", id));
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
  await clean("role", () => db.from("security_role").delete().eq("id", ids.role));
  await clean("contacts", () => db.from("contact").delete().in("id", [ids.contact, ids.person]));
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
