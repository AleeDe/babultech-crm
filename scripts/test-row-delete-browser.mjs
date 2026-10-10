// Deleting from list rows - in a real browser.
//
// An administrator deletes one record of every kind from its list: the row
// disappears and the record waits in the recycle bin. An issued invoice is
// refused with the reason, an approved expense claim is allowed (administrators
// only), and a restore brings a record back. Everything created is removed.
//
// Usage: node scripts/test-row-delete-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

config({ path: ".env", quiet: true });

const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This check only targets the local application.");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const run = randomUUID().slice(0, 6).toUpperCase();
const lower = run.toLowerCase();
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const id = () => randomUUID();
const ids = {
  role: id(), user: null, account: id(), cleanAccount: id(), partnerAccount: id(), lead: id(), product: id(), priceBook: id(),
  partner: id(), article: id(), member: id(), activity: id(), project: id(), deal: id(), quote: id(), contract: id(),
  draftInvoice: id(), sentInvoice: id(), payment: id(), bill: id(), expense: id(), category: null,
};
let browser;

// Each kind: the list, the table it lives in, its id and the name its row shows.
const KINDS = [
  ["Lead", "/leads", "lead", "lead", `QA Row Lead ${run}`],
  ["Account", "/accounts", "account", "cleanAccount", `QA Row Clean Co ${run}`],
  ["Product", "/products", "product", "product", `QA Row Product ${run}`],
  ["Price book", "/price-books", "price_book", "priceBook", `QA Row Book ${run}`],
  ["Partner", "/partners", "partner", "partner", `QA Row Partner ${run}`],
  ["Help article", "/knowledge", "knowledge_article", "article", `QA Row Article ${run}`],
  ["Campaign member", "/campaign-members", "campaign_member", "member", `QA Member ${run}`],
  ["Activity", "/activities", "activity", "activity", `QA Row Call ${run}`],
  ["Quote", "/quotations", "quotation", "quote", `QA-RQ-${run}`],
  ["Contract", "/contracts", "contract", "contract", `QA-RC-${run}`],
  ["Project", "/projects", "project", "project", `QA Row Project ${run}`],
  ["Draft invoice", "/invoices", "invoice", "draftInvoice", `QA-RI1-${run}`],
  ["Payment", "/payments", "payment", "payment", `QA-RP-${run}`],
  ["Supplier bill", "/vendor-bills", "vendor_bill", "bill", `QA-RB-${run}`],
];

try {
  // --- Setup ---------------------------------------------------------------------------
  await must(db.from("security_role").insert({ id: ids.role, name: `QA Row Delete ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() }), "Role");
  const email = `row-delete-${lower}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({ id: ids.user, fullName: `QA Row Delete ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now() }), "User");
  const u = ids.user;

  await must(db.from("account").insert([
    { id: ids.account, accountNumber: `QA-RA-${run}`, name: `QA Row Money Co ${run}`, accountType: "CUSTOMER", ownerUserId: u, updatedAt: now() },
    { id: ids.cleanAccount, accountNumber: `QA-RK-${run}`, name: `QA Row Clean Co ${run}`, accountType: "CUSTOMER", ownerUserId: u, updatedAt: now() },
    { id: ids.partnerAccount, accountNumber: `QA-RPA-${run}`, name: `QA Row Partner Co ${run}`, accountType: "PARTNER", ownerUserId: u, updatedAt: now() },
  ]), "Accounts");
  await must(db.from("lead").insert({ id: ids.lead, leadNumber: `QA-RL-${run}`, firstName: "QA Row", lastName: `Lead ${run}`, email: `row-lead-${lower}@example.com`, ownerUserId: u, status: "NEW", updatedAt: now() }), "Lead");
  await must(db.from("product").insert({ id: ids.product, productCode: "auto", name: `QA Row Product ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now() }), "Product");
  await must(db.from("price_book").insert({ id: ids.priceBook, name: `QA Row Book ${run}`, updatedAt: now() }), "Price book");
  await must(db.from("partner").insert({ id: ids.partner, partnerNumber: `QA-RPT-${run}`, displayName: `QA Row Partner ${run}`, kind: "COMPANY", accountId: ids.partnerAccount, partnerType: "REFERRAL", status: "ACTIVE", partnerManagerId: u, defaultCommissionPercent: 5, updatedAt: now() }), "Partner");
  await must(db.from("knowledge_article").insert({ id: ids.article, articleNumber: `QA-RKB-${run}`, title: `QA Row Article ${run}`, content: "x", status: "DRAFT", visibility: "INTERNAL", authorUserId: u, updatedAt: now() }), "Article");
  await must(db.from("campaign_member").insert({ id: ids.member, firstName: "QA Member", lastName: run, email: `row-member-${lower}@example.com`, ownerUserId: u, updatedAt: now() }), "Member");
  await must(db.from("activity").insert({ id: ids.activity, activityType: "CALL", subject: `QA Row Call ${run}`, ownerUserId: u, relatedEntityType: "Account", relatedEntityId: ids.account, status: "OPEN", updatedAt: now() }), "Activity");
  await must(db.from("opportunity").insert({ id: ids.deal, opportunityNumber: `QA-RD-${run}`, name: `QA Row Deal ${run}`, accountId: ids.account, ownerUserId: u, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: today(), updatedAt: now() }), "Deal");
  await must(db.from("quotation").insert({ id: ids.quote, quoteNumber: `QA-RQ-${run}`, opportunityId: ids.deal, accountId: ids.account, versionNumber: 1, status: "DRAFT", quoteDate: today(), expiryDate: today(), currencyCode: "PKR", subtotal: 0, totalAmount: 0, updatedAt: now() }), "Quote");
  await must(db.from("contract").insert({ id: ids.contract, contractNumber: `QA-RC-${run}`, name: `QA Row Contract ${run}`, accountId: ids.account, ownerUserId: u, contractType: "SERVICE", startDate: today(), endDate: today(), contractValue: 0, status: "DRAFT", updatedAt: now() }), "Contract");
  await must(db.from("project").insert({ id: ids.project, projectNumber: `QA-RPR-${run}`, name: `QA Row Project ${run}`, accountId: ids.account, projectManagerId: u, projectType: "CUSTOMER", billingType: "FIXED", status: "PLANNING", currencyCode: "PKR", updatedAt: now() }), "Project");
  await must(db.from("invoice").insert([
    { id: ids.draftInvoice, invoiceNumber: `QA-RI1-${run}`, accountId: ids.account, invoiceDate: today(), dueDate: today(), currencyCode: "PKR", status: "DRAFT", updatedAt: now() },
    { id: ids.sentInvoice, invoiceNumber: `QA-RI2-${run}`, accountId: ids.account, invoiceDate: today(), dueDate: today(), currencyCode: "PKR", status: "SENT", updatedAt: now() },
  ]), "Invoices");
  await must(db.from("payment").insert({ id: ids.payment, paymentNumber: `QA-RP-${run}`, accountId: ids.account, paymentDate: today(), amount: 10, unallocatedAmount: 10, currencyCode: "PKR", paymentMethod: "BANK", updatedAt: now() }), "Payment");
  await must(db.from("vendor_bill").insert({ id: ids.bill, billNumber: `QA-RB-${run}`, vendorAccountId: ids.account, billDate: today(), dueDate: today(), currencyCode: "PKR", status: "DRAFT", updatedAt: now() }), "Bill");
  const category = await must(db.from("expense_category").select("id").limit(1).single(), "Expense category");
  await must(db.from("expense").insert({ id: ids.expense, expenseNumber: `QA-RE-${run}`, categoryId: category.id, expenseDate: today(), amount: 100, currencyCode: "PKR", description: `QA approved claim ${run}`, approvalStatus: "APPROVED", updatedAt: now() }), "Expense");
  pass("An administrator, and one record of each kind");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60000 });

  // A delete reloads the page; a navigation that lands mid-reload is aborted
  // and simply tried again.
  async function open(url) {
    for (let i = 0; i < 3; i++) {
      try {
        return await page.goto(url, { waitUntil: "networkidle" });
      } catch (err) {
        if (!String(err.message).includes("ERR_ABORTED") || i === 2) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  async function deleteFromList(path, name) {
    await open(`${base}${path}?search=${encodeURIComponent(run)}`);
    await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
    await page.locator('input[name="deleteReason"]').fill("QA clean-up");
    await page.getByRole("button", { name: `Yes, delete ${name}`, exact: true }).click();
  }

  // --- Every kind, from its list ---------------------------------------------------------
  for (const [label, path, table, key, name] of KINDS) {
    await deleteFromList(path, name);
    await page.waitForLoadState("networkidle");
    let row = null;
    for (let i = 0; i < 20; i++) {
      row = (await db.from(table).select("deletedAt, deletedById").eq("id", ids[key]).single()).data;
      if (row?.deletedById) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(row?.deletedAt && row.deletedById === ids.user, `${label} is in the recycle bin`);
    await open(`${base}${path}?search=${encodeURIComponent(run)}`);
    assert.equal(await page.getByRole("button", { name: `Delete ${name}`, exact: true }).count(), 0, `${label} has left its list`);
    pass(`${label}: deleted from its list row, gone from the list, in the recycle bin`);
  }

  // --- An issued invoice, with no payment against it, is the Super Admin's to delete -----
  await deleteFromList("/invoices", `QA-RI2-${run}`);
  let sent = null;
  for (let i = 0; i < 20; i++) {
    sent = (await db.from("invoice").select("deletedById").eq("id", ids.sentInvoice).single()).data;
    if (sent?.deletedById) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(sent?.deletedById, ids.user);
  pass("The Super Admin deletes even an issued invoice, when no payment is allocated to it");

  // --- An approved expense claim, by an administrator -----------------------------------
  await open(`${base}/expenses?search=${encodeURIComponent(run)}`);
  await page.getByRole("button", { name: `Delete QA-RE-${run}`, exact: true }).click();
  await page.locator('input[name="deleteReason"]').fill("QA clean-up");
  await page.getByRole("button", { name: `Yes, delete QA-RE-${run}`, exact: true }).click();
  let claim = null;
  for (let i = 0; i < 20; i++) {
    claim = (await db.from("expense").select("deletedById").eq("id", ids.expense).single()).data;
    if (claim?.deletedById) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(claim?.deletedById, ids.user);
  pass("The Super Admin deletes an approved expense claim to the recycle bin");

  // --- The recycle bin lists them, and restores one -------------------------------------
  await open(`${base}/recycle-bin`);
  for (const text of [`QA-RI1-${run}`, `QA Row Partner ${run}`, `QA-RE-${run}`]) await page.getByText(text).first().waitFor({ timeout: 15000 });
  const productRow = page.locator("tr", { hasText: `QA Row Product ${run}` });
  await productRow.getByRole("button", { name: "Restore" }).click();
  let restored = null;
  for (let i = 0; i < 20; i++) {
    restored = (await db.from("product").select("deletedAt").eq("id", ids.product).single()).data;
    if (restored && !restored.deletedAt) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(restored.deletedAt, null);
  await open(`${base}/products?search=${encodeURIComponent(run)}`);
  await page.getByRole("button", { name: `Delete QA Row Product ${run}`, exact: true }).waitFor({ timeout: 15000 });
  pass("The recycle bin lists the new kinds and restores a product to its list");

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
  await clean("expense", () => db.from("expense").delete().eq("id", ids.expense));
  await clean("bill", () => db.from("vendor_bill").delete().eq("id", ids.bill));
  await clean("payment", () => db.from("payment").delete().eq("id", ids.payment));
  await clean("invoices", () => db.from("invoice").delete().in("id", [ids.draftInvoice, ids.sentInvoice]));
  await clean("project", () => db.from("project").delete().eq("id", ids.project));
  await clean("contract", () => db.from("contract").delete().eq("id", ids.contract));
  await clean("quote", () => db.from("quotation").delete().eq("id", ids.quote));
  await clean("deal", () => db.from("opportunity").delete().eq("id", ids.deal));
  await clean("activity", () => db.from("activity").delete().eq("id", ids.activity));
  await clean("member", () => db.from("campaign_member").delete().eq("id", ids.member));
  await clean("article", () => db.from("knowledge_article").delete().eq("id", ids.article));
  await clean("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await clean("price book", () => db.from("price_book").delete().eq("id", ids.priceBook));
  await clean("product", () => db.from("product").delete().eq("id", ids.product));
  await clean("lead", () => db.from("lead").delete().eq("id", ids.lead));
  await clean("contacts", () => db.from("contact").delete().in("accountId", [ids.account, ids.cleanAccount, ids.partnerAccount]));
  await clean("accounts", () => db.from("account").delete().in("id", [ids.account, ids.cleanAccount, ids.partnerAccount]));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", Object.values(ids).filter((v) => typeof v === "string")));
  if (ids.user) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record"]) await clean(t, () => db.from(t).delete().eq("userId", ids.user));
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
