// A partner editing an account, a contact and a deal, and closing deals,
// through the portal screens in a real browser.
//
// scripts/test-partner-deals.mjs proves the database refuses what it should;
// this checks the screens: the edit forms save, the stage control moves a deal
// and says why when it will not, and winning reports the project it started.
//
// Everything created is removed afterwards.
//
// Usage: node scripts/test-partner-deals-browser.mjs http://localhost:3100
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
  partnerAccount: randomUUID(), partner: randomUUID(), person: randomUUID(), login: null,
  customer: randomUUID(), contact: randomUUID(), deal: randomUUID(), deal2: randomUUID(),
  product: randomUUID(), quote: randomUUID(),
};
let browser;

try {
  step("00", "A partner, their customer, a contact and two deals");

  const owner = await must(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  );
  await must(db.from("account").insert({
    id: ids.partnerAccount, accountNumber: `QPDB-P-${run}`, name: `QA Portal Deals ${run}`,
    accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now(),
  }), "Create the partner's company");
  await must(db.from("contact").insert({
    id: ids.person, accountId: ids.partnerAccount, firstName: "Portal", lastName: `Seller ${run}`,
    email: `qpdb-${tag}@example.com`, updatedAt: now(),
  }), "Create the partner's person");
  await must(db.from("partner").insert({
    id: ids.partner, partnerNumber: `QPDB-${run}`, displayName: `QA Portal Deals ${run}`, kind: "COMPANY",
    accountId: ids.partnerAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: owner.id, defaultCommissionPercent: 10, updatedAt: now(),
  }), "Create the partner");
  const role = await must(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const email = `qpdb-${tag}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.login = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.login, fullName: `QA Seller ${run}`, email, roleId: role.id, userType: "PARTNER",
    partnerId: ids.partner, contactId: ids.person, status: "ACTIVE", updatedAt: now(),
  }), "Create the login");

  await must(db.from("account").insert({
    id: ids.customer, accountNumber: `QPDB-C-${run}`, name: `QA Deals Customer ${run}`,
    accountType: "PROSPECT", ownerUserId: owner.id, sourcePartnerId: ids.partner, updatedAt: now(),
  }), "Create their customer");
  await must(db.from("contact").insert({
    id: ids.contact, accountId: ids.customer, firstName: "Hina", lastName: `Buyer ${run}`,
    email: `qpdb-hina-${tag}@example.com`, isPrimary: true, sourcePartnerId: ids.partner, updatedAt: now(),
  }), "Create their contact");
  await must(db.from("opportunity").insert([
    { id: ids.deal, opportunityNumber: `QPDB-D1-${run}`, name: `QA Rollout ${run}`, accountId: ids.customer, ownerUserId: owner.id, stage: "DISCOVERY", amount: 20000, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: ids.partner, updatedAt: now() },
    { id: ids.deal2, opportunityNumber: `QPDB-D2-${run}`, name: `QA Pilot ${run}`, accountId: ids.customer, ownerUserId: owner.id, stage: "DISCOVERY", amount: 5000, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: ids.partner, updatedAt: now() },
  ]), "Create two deals");
  await must(db.from("product").insert({
    id: ids.product, productCode: "auto", name: `QA Deals Item ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now(),
  }), "Create a product");
  pass("Records ready");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  step("01", "Editing the account");

  await page.goto(`${base}/portal/customers/${ids.customer}`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/edit$/);
  await page.locator('input[name="name"]').fill(`QA Deals Customer Ltd ${run}`);
  await page.locator('input[name="city"]').fill("Lahore");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(new RegExp(`/portal/customers/${ids.customer}$`), { timeout: 30000 });
  await page.getByRole("heading", { name: `QA Deals Customer Ltd ${run}` }).waitFor({ timeout: 20000 });
  assert.ok((await page.locator("body").innerText()).includes("Lahore"), "The address shows");
  pass("Account renamed and given a city through its edit form");

  step("02", "Editing a contact");

  await page.getByRole("link", { name: `Hina Buyer ${run}` }).click();
  await page.waitForURL(/\/contacts\/[0-9a-f-]{36}$/);
  await page.locator('input[name="jobTitle"]').fill("Head of Operations");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(new RegExp(`/portal/customers/${ids.customer}$`), { timeout: 30000 });
  await page.getByText("Head of Operations").first().waitFor({ timeout: 20000 });
  pass("The contact's job title saved and shows on the account");

  step("03", "Editing the deal");

  await page.getByRole("link", { name: `QA Rollout ${run}` }).click();
  await page.waitForURL(new RegExp(`/portal/deals/${ids.deal}$`));
  await page.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/edit$/);
  await page.locator('input[name="nextStep"]').fill(`Send the proposal ${run}`);
  await page.locator('input[name="probabilityPercent"]').fill("35");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(new RegExp(`/portal/deals/${ids.deal}$`), { timeout: 30000 });
  await page.getByText(`Send the proposal ${run}`).waitFor({ timeout: 20000 });
  pass("Next step and probability saved through the deal's edit form");

  step("04", "Moving the stage, and being told why a win is refused");

  await page.getByLabel("Stage").selectOption("NEGOTIATION");
  await page.getByRole("button", { name: "Move" }).click();
  await page.getByText("Moved to Negotiation.").waitFor({ timeout: 30000 });
  await page.getByLabel("Stage").selectOption("CLOSED_WON");
  assert.ok(await page.getByText(/there is none on this deal yet/).isVisible(), "It warns there is no accepted quote");
  await page.getByRole("button", { name: "Move" }).click();
  await page.getByText(/A won deal needs at least one product or service/).waitFor({ timeout: 30000 });
  pass("Moved to Negotiation; winning with nothing on the deal is refused, with the reason");

  step("05", "Winning, once there is a product and an accepted quote");

  await must(db.from("opportunity_product").insert({
    opportunityId: ids.deal, productId: ids.product, quantity: 1, unitPrice: 20000, sortOrder: 1,
  }), "Add a line");
  await must(db.from("quotation").insert({
    id: ids.quote, quoteNumber: `QPDB-Q-${run}`, opportunityId: ids.deal, accountId: ids.customer, versionNumber: 1,
    status: "ACCEPTED", quoteDate: "2026-09-27", expiryDate: "2026-10-27", currencyCode: "PKR", updatedAt: now(),
  }), "Record an accepted quote");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByLabel("Stage").selectOption("CLOSED_WON");
  await page.getByRole("button", { name: "Move" }).click();
  await page.getByText(/Won\. Delivery project PRJ-\d{4}-\d+ has been started/).waitFor({ timeout: 30000 });
  const body = await page.locator("body").innerText();
  assert.match(body, /Commission due/, "The commission tile shows when it is due");
  pass("Won: the notice names the delivery project, and the commission shows its due date");

  step("06", "Losing, with a reason");

  await page.goto(`${base}/portal/deals/${ids.deal2}`, { waitUntil: "networkidle" });
  await page.getByLabel("Stage").selectOption("CLOSED_LOST");
  await page.locator('input[name="lossReason"]').fill("Went with a cheaper supplier");
  await page.getByRole("button", { name: "Move" }).click();
  await page.getByText("Moved to Closed Lost.").waitFor({ timeout: 30000 });
  await page.getByText("Went with a cheaper supplier").first().waitFor({ timeout: 20000 });
  pass("Lost with its reason recorded on the deal");

  step("07", "Nothing threw");
  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");

  console.log(`\n${"═".repeat(64)}\n${passed.length} checks passed.\n${"═".repeat(64)}\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  const failures = [];
  const clean = async (what, fn) => {
    const r = await fn();
    if (r?.error) failures.push(`${what}: ${r.error.message}`);
  };
  const deals = [ids.deal, ids.deal2];
  const { data: records } = await db.from("partner_commission").select("id").in("opportunityId", deals);
  const recordIds = (records ?? []).map((r) => r.id);
  if (recordIds.length) await clean("commission history", () => db.from("audit_history").delete().in("entityId", recordIds));
  const { data: projects } = await db.from("project").select("id").in("opportunityId", deals);
  const projectIds = (projects ?? []).map((p) => p.id);
  if (projectIds.length) {
    await clean("tasks", () => db.from("project_task").delete().in("projectId", projectIds));
    await clean("members", () => db.from("project_member").delete().in("projectId", projectIds));
    await clean("projects", () => db.from("project").delete().in("id", projectIds));
  }
  if (ids.login) await clean("activities", () => db.from("activity").delete().eq("ownerUserId", ids.login));
  await clean("deals", () => db.from("opportunity").delete().in("id", deals));
  await clean("product", () => db.from("product").delete().eq("id", ids.product));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [...deals, ids.customer, ids.contact]));
  if (ids.login) {
    await clean("login", () => db.from("app_user").delete().eq("id", ids.login));
    await db.auth.admin.deleteUser(ids.login).catch(() => {});
  }
  await clean("contacts", () => db.from("contact").delete().in("id", [ids.contact, ids.person]));
  await clean("customer", () => db.from("account").delete().eq("id", ids.customer));
  await clean("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await clean("partner company", () => db.from("account").delete().eq("id", ids.partnerAccount));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
