// The remaining items - in a real browser.
//
//   1. Account 360 and Contact 360
//   2. Duplicate accounts and contacts, merged
//   3. Favourites
//   4. Data quality
//   5. Preferences: time zone, date format, start page
//   6. Record numbering (refusal only: the live sequences are never changed)
//   7. Webhooks, delivered to a receiver this script runs, and the log
//   8. The portal assistant, for a customer and for a partner
//
// The server must be started with WEBHOOK_ALLOW_PRIVATE=1 so it may post to the
// local receiver. Everything created is removed. No email is sent: every
// address is example.com, and a case is only raised by the assistant when it
// would go to this script's own temporary login.
//
// Usage: node scripts/test-remaining-items-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const today = () => now().slice(0, 10);
const passed = [];
const errors = [];
const pages = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ids = {
  role: randomUUID(), staff: null, logins: [],
  account: randomUUID(), dupAccount: randomUUID(), partnerAccount: randomUUID(), partner: randomUUID(),
  contact: randomUUID(), dupContact: randomUUID(), buyer: randomUUID(), seller: randomUUID(), sellerUser: randomUUID(),
  product: randomUUID(), deal: randomUUID(), dupDeal: randomUUID(), partnerDeal: randomUUID(),
  project: randomUUID(), caseId: randomUUID(), lead: randomUUID(), article: randomUUID(), hookLead: randomUUID(),
  webhooks: [],
};
const caseIdsRaised = [];

// --- A webhook receiver -----------------------------------------------------------
const received = [];
const receiver = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ path: req.url, headers: req.headers, body });
    res.writeHead(req.url === "/fail" ? 500 : 200, { "content-type": "application/json" });
    res.end(req.url === "/fail" ? '{"error":"down"}' : '{"ok":true}');
  });
});
await new Promise((r) => receiver.listen(3999, "127.0.0.1", r));

async function makeLogin(email, fields) {
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.logins.push(auth.data.user.id);
  await must(db.from("app_user").insert({ id: auth.data.user.id, email, status: "ACTIVE", updatedAt: now(), ...fields }), `Login for ${fields.fullName}`);
  return { id: auth.data.user.id, email, password };
}

let browser;
async function signedIn(login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  page.on("dialog", (d) => d.accept());
  pages.push(page);
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(login.email);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  return page;
}

try {
  // --- Setup ------------------------------------------------------------------------------
  await must(db.from("security_role").insert({ id: ids.role, name: `QA Remaining ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() }), "Role");
  const staff = await makeLogin(`rem-staff-${lower}@example.com`, { fullName: `QA Staff ${run}`, roleId: ids.role });
  ids.staff = staff.id;
  const customerRole = await must(db.from("security_role").select("id").eq("name", "Customer").single(), "Customer role");
  const partnerRole = await must(db.from("security_role").select("id").eq("name", "Partner").single(), "Partner role");

  await must(db.from("account").insert([
    { id: ids.account, accountNumber: `QA-RM-A-${run}`, name: `QA Remaining Co ${run}`, accountType: "CUSTOMER", ownerUserId: ids.staff, updatedAt: now() },
    { id: ids.dupAccount, accountNumber: `QA-RM-B-${run}`, name: `QA Remaining Co ${run} (Pvt) Ltd`, accountType: "CUSTOMER", ownerUserId: ids.staff, website: `https://rm-${lower}.example.com`, updatedAt: now() },
    { id: ids.partnerAccount, accountNumber: `QA-RM-P-${run}`, name: `QA Remaining Partner ${run}`, accountType: "PARTNER", ownerUserId: ids.staff, updatedAt: now() },
  ]), "Accounts");
  await must(db.from("contact").insert([
    { id: ids.contact, accountId: ids.account, firstName: "Ahmed", lastName: `Khan ${run}`, email: `rm-ahmed-${lower}@example.com`, updatedAt: now() },
    { id: ids.dupContact, accountId: ids.account, firstName: "Ahmed", lastName: `Khan ${run}`, phone: `+92 300 ${String(Date.now()).slice(-7)}`, updatedAt: now() },
    { id: ids.buyer, accountId: ids.account, firstName: "Buyer", lastName: run, email: `rm-buyer-${lower}@example.com`, updatedAt: now() },
    { id: ids.seller, accountId: ids.partnerAccount, firstName: "Seller", lastName: run, email: `rm-seller-${lower}@example.com`, updatedAt: now() },
    { id: ids.sellerUser, accountId: ids.partnerAccount, firstName: "Seller", lastName: `User ${run}`, email: `rm-seller-user-${lower}@example.com`, updatedAt: now() },
  ]), "Contacts");
  await must(db.from("partner").insert({
    id: ids.partner, partnerNumber: `QA-RM-${run}`, displayName: `QA Remaining Partner ${run}`, kind: "COMPANY", accountId: ids.partnerAccount,
    partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE", partnerManagerId: ids.staff, defaultCommissionPercent: 10, updatedAt: now(),
  }), "Partner");
  await must(db.from("product").insert({ id: ids.product, productCode: "auto", name: `QA 360 Licence ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now() }), "Product");
  await must(db.from("opportunity").insert([
    { id: ids.deal, opportunityNumber: `QA-RM-D-${run}`, name: `QA 360 deal ${run}`, accountId: ids.account, primaryContactId: ids.contact, ownerUserId: ids.staff, stage: "NEGOTIATION", amount: 0, currencyCode: "PKR", expectedCloseDate: today(), updatedAt: now() },
    { id: ids.dupDeal, opportunityNumber: `QA-RM-E-${run}`, name: `QA duplicate's deal ${run}`, accountId: ids.dupAccount, ownerUserId: ids.staff, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: today(), updatedAt: now() },
    { id: ids.partnerDeal, opportunityNumber: `QA-RM-F-${run}`, name: `QA partner deal ${run}`, accountId: ids.account, ownerUserId: ids.staff, sourcePartnerId: ids.partner, stage: "QUALIFICATION", amount: 0, currencyCode: "PKR", expectedCloseDate: today(), updatedAt: now() },
  ]), "Deals");
  await must(db.from("opportunity_product").insert({ opportunityId: ids.deal, productId: ids.product, quantity: 3, unitPrice: 100000, sortOrder: 1 }), "Deal line");
  await must(db.from("opportunity").update({ stage: "CLOSED_WON", actualCloseDate: today(), updatedAt: now() }).eq("id", ids.deal), "Win the deal");
  await must(db.from("project").insert({ id: ids.project, projectNumber: `QA-RM-PR-${run}`, name: `QA 360 project ${run}`, accountId: ids.account, opportunityId: ids.deal, projectManagerId: ids.staff, projectType: "CUSTOMER", billingType: "FIXED", status: "PLANNING", currencyCode: "PKR", updatedAt: now() }), "Project");
  await must(db.from("support_case").insert({ id: ids.caseId, caseNumber: `QA-RM-C-${run}`, subject: `QA 360 case ${run}`, description: "x", accountId: ids.account, contactId: ids.contact, ownerUserId: ids.staff, source: "EMAIL", updatedAt: now() }), "Case");
  await must(db.from("lead").insert({ id: ids.lead, leadNumber: `QA-RM-L-${run}`, firstName: "Converted", lastName: `Lead ${run}`, email: `rm-lead-${lower}@example.com`, ownerUserId: ids.staff, status: "CONVERTED", convertedAt: now(), convertedAccountId: ids.account, convertedContactId: ids.contact, updatedAt: now() }), "Lead");
  await must(db.from("knowledge_article").insert({ id: ids.article, articleNumber: `QA-RM-KB-${run}`, title: `Reset your password ${run}`, content: "Use Forgot password on the sign-in page.", status: "PUBLISHED", visibility: "CUSTOMER_PORTAL", authorUserId: ids.staff, publishedAt: now(), updatedAt: now() }), "Article");

  const buyer = await makeLogin(`rm-buyer-${lower}@example.com`, { fullName: `Buyer ${run}`, roleId: customerRole.id, userType: "CUSTOMER", contactId: ids.buyer, portalScope: "ACCOUNT", portalRole: "ADMIN" });
  const seller = await makeLogin(`rm-seller-${lower}@example.com`, { fullName: `Seller ${run}`, roleId: partnerRole.id, userType: "PARTNER", partnerId: ids.partner, contactId: ids.seller, portalRole: "ADMIN" });
  const sellerUser = await makeLogin(`rm-seller-user-${lower}@example.com`, { fullName: `Seller User ${run}`, roleId: partnerRole.id, userType: "PARTNER", partnerId: ids.partner, contactId: ids.sellerUser, portalRole: "USER" });
  pass("Our person, two look-alike accounts and contacts, a won deal, a project, a case, a lead, an article, a customer and a partner");

  browser = await chromium.launch({ headless: true });
  const ours = await signedIn(staff);

  // --- 1. Account 360 and Contact 360 ---------------------------------------------------
  await ours.goto(`${base}/accounts/${ids.account}`, { waitUntil: "networkidle" });
  for (const text of ["Revenue", `QA 360 Licence ${run}`, `QA 360 project ${run}`, `Converted Lead ${run}`, "Campaign influence"]) {
    await ours.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
  }
  // \s: the currency formatter puts a non-breaking space after the code.
  assert.match(await ours.locator("body").innerText(), /PKR\s300,000\.00/);
  pass("Account 360: revenue won, products bought, projects, converted leads and campaign influence");

  await ours.goto(`${base}/contacts/${ids.contact}`, { waitUntil: "networkidle" });
  for (const text of [`QA 360 deal ${run}`, `QA 360 case ${run}`, `QA 360 project ${run}`, `Converted Lead ${run}`, "Lead history"]) {
    await ours.getByText(text, { exact: false }).first().waitFor({ timeout: 15000 });
  }
  pass("Contact 360: their deals, cases, projects and lead history");

  // --- 3. Favourites ----------------------------------------------------------------------
  await ours.goto(`${base}/accounts/${ids.account}`, { waitUntil: "networkidle" });
  await ours.getByRole("button", { name: "Add to favourites" }).click();
  await ours.getByRole("button", { name: "Remove from favourites" }).waitFor({ timeout: 15000 });
  const fav = await must(db.from("favorite_record").select("label").eq("userId", ids.staff).eq("entityId", ids.account), "Favourite");
  assert.equal(fav.length, 1);
  await ours.goto(`${base}/my-work`, { waitUntil: "networkidle" });
  await ours.getByText("Favourites").first().waitFor({ timeout: 15000 });
  await ours.getByRole("link", { name: new RegExp(`QA Remaining Co ${run}`) }).first().waitFor();
  const recent = await (await ours.request.get(`${base}/api/recent`)).json();
  assert.ok(recent.favorites.some((f) => f.href === `/accounts/${ids.account}`), "Favourites reach the search box");
  pass("A record is starred, and shows under Favourites on My work and in search");

  // --- 4. Data quality ---------------------------------------------------------------------
  await ours.goto(`${base}/data-quality`, { waitUntil: "networkidle" });
  await ours.locator('[data-rule="ACCOUNT_NO_WEBSITE"]').getByText(`QA Remaining Co ${run}`, { exact: true }).waitFor({ timeout: 15000 });
  await ours.goto(`${base}/data-quality?mine=1`, { waitUntil: "networkidle" });
  await ours.locator('[data-rule="ACCOUNT_NO_WEBSITE"]').getByText(`QA Remaining Co ${run}`, { exact: true }).waitFor({ timeout: 15000 });
  pass("Data quality lists the account with no website, and Only mine keeps it");

  // --- 2. Merge accounts, then contacts ------------------------------------------------------
  await ours.goto(`${base}/accounts/duplicates`, { waitUntil: "networkidle" });
  const group = ours.locator("div.rounded-lg, div[class*='rounded']", { hasText: `QA Remaining Co ${run} (Pvt) Ltd` }).filter({ has: ours.getByRole("link", { name: "Merge these" }) }).last();
  await group.getByRole("link", { name: "Merge these" }).click();
  await ours.waitForURL(/\/accounts\/merge\?ids=/, { timeout: 30000 });
  // Keep the first account; take the duplicate's website.
  await ours.getByLabel(`Keep QA Remaining Co ${run}`, { exact: true }).check();
  await ours.getByRole("button", { name: /Merge 1 into this record/ }).click();
  await ours.waitForURL(new RegExp(`/accounts/${ids.account}$`), { timeout: 30000 });
  const loser = await must(db.from("account").select("mergedIntoId, deletedAt").eq("id", ids.dupAccount).single(), "Merged account");
  assert.equal(loser.mergedIntoId, ids.account);
  assert.ok(loser.deletedAt);
  const kept = await must(db.from("account").select("website").eq("id", ids.account).single(), "Kept account");
  assert.equal(kept.website, `https://rm-${lower}.example.com`);
  assert.equal((await must(db.from("opportunity").select("accountId").eq("id", ids.dupDeal).single(), "Moved deal")).accountId, ids.account);
  assert.equal((await must(db.from("record_merge").select("id").eq("survivorId", ids.account), "History")).length, 1);
  pass("Two accounts are merged: the website is kept, the deal moves, the duplicate is retired and the merge recorded");

  await ours.goto(`${base}/contacts/duplicates`, { waitUntil: "networkidle" });
  await ours.getByText(`the name Ahmed Khan ${run} at one account`).waitFor({ timeout: 15000 });
  await ours.goto(`${base}/contacts/merge?ids=${ids.contact},${ids.dupContact}`, { waitUntil: "networkidle" });
  await ours.getByRole("button", { name: /Merge 1 into this record/ }).click();
  await ours.waitForURL(/\/contacts\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const contacts = await must(db.from("contact").select("id, mergedIntoId, email, phone").in("id", [ids.contact, ids.dupContact]), "Contacts");
  const survivor = contacts.find((c) => !c.mergedIntoId);
  assert.ok(survivor && survivor.email && survivor.phone, "The contact kept has both the email and the phone");
  pass("Two contacts are merged, keeping the email from one and the phone from the other");
  ids.contactKept = survivor.id;

  // --- 6. Record numbering (refusal only) --------------------------------------------------
  await ours.goto(`${base}/settings/numbering`, { waitUntil: "networkidle" });
  const row = ours.locator('[data-sequence="Payment"]');
  const nextBefore = await row.getByLabel("Payment next number").inputValue();
  if (Number(nextBefore) > 1) {
    await row.getByLabel("Payment next number").fill(String(Number(nextBefore) - 1));
    await row.getByRole("button", { name: "Save" }).click();
    await ours.getByText("The next number can only go up").waitFor({ timeout: 15000 });
  }
  const seq = await must(db.from("number_sequence").select("nextValue").eq("entityType", "Payment").single(), "Sequence");
  assert.equal(String(seq.nextValue), nextBefore);
  pass("Record numbering shows each sequence, and refuses to take a next number backwards");

  // --- 7. Webhooks ------------------------------------------------------------------------------
  await ours.goto(`${base}/settings/integrations`, { waitUntil: "networkidle" });
  await ours.getByRole("button", { name: "Add a webhook" }).click();
  await ours.getByLabel("Webhook name").fill(`QA hook ${run}`);
  await ours.getByLabel("Webhook address").fill("http://localhost:3999/hook");
  await ours.locator("[data-webhook-form]").getByText("A lead is created").click();
  await ours.getByRole("button", { name: "Save webhook" }).click();
  await ours.locator(`[data-webhook="QA hook ${run}"]`).waitFor({ timeout: 30000 });
  const hook = await must(db.from("webhook").select("id, secret, events").eq("name", `QA hook ${run}`).single(), "Webhook");
  ids.webhooks.push(hook.id);
  assert.deepEqual(hook.events, ["lead.created"]);
  assert.match(hook.secret, /^whsec_/);

  // A lead created now is queued for it; the test delivery's run posts both.
  await must(db.from("lead").insert({ id: ids.hookLead, leadNumber: `QA-RM-H-${run}`, firstName: "Hook", lastName: run, email: `rm-hook-${lower}@example.com`, ownerUserId: ids.staff, status: "NEW", updatedAt: now() }), "Lead for the webhook");
  await ours.locator(`[data-webhook="QA hook ${run}"]`).getByRole("button", { name: "Send a test" }).click();
  for (let i = 0; i < 30 && received.filter((r) => r.path === "/hook").length < 2; i++) await wait(1000);
  const hits = received.filter((r) => r.path === "/hook");
  assert.equal(hits.length, 2, "Both the test and the lead were delivered");
  for (const hit of hits) {
    const expected = `sha256=${createHmac("sha256", hook.secret).update(`${hit.headers["x-babultech-timestamp"]}.${hit.body}`).digest("hex")}`;
    assert.equal(hit.headers["x-babultech-signature"], expected, "Signed with the secret");
  }
  const leadHit = hits.find((h) => h.headers["x-babultech-event"] === "lead.created");
  assert.equal(JSON.parse(leadHit.body).data.number, `QA-RM-H-${run}`);
  await wait(1500);
  const logs = await must(db.from("integration_log").select("event, status, httpStatus").eq("webhookId", hook.id), "Log");
  assert.ok(logs.length === 2 && logs.every((l) => l.status === "SUCCESS" && l.httpStatus === 200), JSON.stringify(logs));
  await ours.reload({ waitUntil: "networkidle" });
  await ours.locator('[data-log-event="lead.created"]').first().getByText("success").waitFor({ timeout: 15000 });
  pass("A webhook gets a signed test and a new lead, and the log shows both delivered");

  // A receiver that fails is retried.
  await ours.getByRole("button", { name: "Add a webhook" }).click();
  await ours.getByLabel("Webhook name").fill(`QA failing hook ${run}`);
  await ours.getByLabel("Webhook address").fill("http://localhost:3999/fail");
  await ours.locator("[data-webhook-form]").getByText("A deal is won").click();
  await ours.getByRole("button", { name: "Save webhook" }).click();
  await ours.locator(`[data-webhook="QA failing hook ${run}"]`).waitFor({ timeout: 30000 });
  const failing = await must(db.from("webhook").select("id").eq("name", `QA failing hook ${run}`).single(), "Failing webhook");
  ids.webhooks.push(failing.id);
  await ours.locator(`[data-webhook="QA failing hook ${run}"]`).getByRole("button", { name: "Send a test" }).click();
  let failed = null;
  for (let i = 0; i < 30 && !failed; i++) {
    await wait(1000);
    failed = (await db.from("integration_log").select("status, httpStatus, nextAttemptAt, errorMessage").eq("webhookId", failing.id).eq("status", "FAILED").maybeSingle()).data;
  }
  assert.ok(failed, "The failed delivery is waiting to be retried");
  assert.equal(failed.httpStatus, 500);
  // The column has no time zone and holds UTC, so it comes back without the Z.
  assert.ok(new Date(`${failed.nextAttemptAt}Z`) > new Date(), "It is retried later");
  await ours.reload({ waitUntil: "networkidle" });
  await ours.getByRole("button", { name: "Retry" }).first().waitFor({ timeout: 15000 });
  pass("A receiver answering 500 is logged and retried later, with a Retry button");

  // --- 5. Preferences ---------------------------------------------------------------------------
  await ours.goto(`${base}/profile`, { waitUntil: "networkidle" });
  await ours.getByLabel("Time zone").selectOption("America/Toronto");
  await ours.getByLabel("Date format").selectOption("YMD");
  await ours.getByLabel("Start page").selectOption("/my-work");
  await ours.getByRole("button", { name: "Save preferences" }).click();
  await ours.getByText("Saved. Dates now show").waitFor({ timeout: 15000 });
  await ours.waitForLoadState("networkidle");
  await wait(1500);
  const pref = await must(db.from("user_preference").select("timeZone, dateFormat, startPage").eq("userId", ids.staff).single(), "Preference");
  assert.deepEqual(pref, { timeZone: "America/Toronto", dateFormat: "YMD", startPage: "/my-work" });
  await ours.goto(`${base}/cases/${ids.caseId}`, { waitUntil: "networkidle" });
  assert.match(await ours.locator("main").innerText(), /\b20\d\d-\d\d-\d\d\b/, "Dates read in the chosen format");
  const again = await signedIn(staff);
  assert.equal(new URL(again.url()).pathname, "/my-work", "Signing in lands on the start page");
  pass("Preferences: dates follow the chosen format, and signing in lands on the chosen start page");

  // --- 8. The portal assistant -------------------------------------------------------------------
  const { data: assignee } = await db.rpc("next_support_assignee");
  const casesGoToUs = !assignee;
  const customer = await signedIn(buyer);
  await customer.goto(`${base}/support`, { waitUntil: "networkidle" });
  await customer.getByRole("button", { name: "Ask the assistant" }).click();
  const panel = customer.getByRole("region", { name: "Portal assistant" });
  await panel.getByRole("button", { name: "Show my open cases" }).click();
  await panel.getByRole("link", { name: new RegExp(`QA-RM-C-${run}`) }).waitFor({ timeout: 20000 });
  await panel.getByLabel("Message the assistant").fill("How do I reset my password?");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByRole("link", { name: `Reset your password ${run}` }).waitFor({ timeout: 20000 });
  await panel.getByLabel("Message the assistant").fill("What's the next milestone?");
  await panel.getByRole("button", { name: "Send", exact: true }).click();
  await panel.getByText(/next milestone|no upcoming milestones/i).last().waitFor({ timeout: 20000 });
  pass("The customer assistant lists open tickets, finds a help article and answers about milestones");

  if (casesGoToUs) {
    await panel.getByLabel("Message the assistant").fill(`My application is not loading ${run}`);
    await panel.getByRole("button", { name: "Send", exact: true }).click();
    await panel.getByText("Tell me a little more").waitFor({ timeout: 20000 });
    await panel.getByLabel("Message the assistant").fill("Since this morning, a blank page after sign-in.");
    await panel.getByRole("button", { name: "Send", exact: true }).click();
    await panel.getByRole("button", { name: "Urgent", exact: true }).click();
    await panel.getByRole("button", { name: "Raise the case" }).click();
    await panel.getByText(/Your case .+ has been created\. The support team has been notified\./).waitFor({ timeout: 30000 });
    const raised = await must(db.from("support_case").select("id, source, priority, contactId, accountId, ownerUserId, description").eq("subject", `My application is not loading ${run}`).single(), "Raised case");
    caseIdsRaised.push(raised.id);
    await db.from("notification").update({ emailStatus: "SKIPPED" }).eq("userId", ids.staff);
    assert.equal(raised.source, "CHATBOT");
    assert.equal(raised.priority, "HIGH");
    assert.equal(raised.contactId, ids.buyer);
    assert.equal(raised.accountId, ids.account);
    assert.equal(raised.ownerUserId, ids.staff);
    assert.match(raised.description, /Conversation with the portal assistant/);
    pass("The assistant raises a case: origin Chatbot, the customer's account and contact, the conversation kept");
  } else {
    console.log("  SKIP  Raising a case through the assistant - it would be assigned to a real support person");
  }

  const partner = await signedIn(seller);
  await partner.goto(`${base}/portal`, { waitUntil: "networkidle" });
  await partner.getByRole("button", { name: "Ask the assistant" }).click();
  const ppanel = partner.getByRole("region", { name: "Portal assistant" });
  await ppanel.getByRole("button", { name: "Show my opportunities" }).click();
  await ppanel.getByRole("link", { name: new RegExp(`QA partner deal ${run}`) }).waitFor({ timeout: 20000 });
  await ppanel.getByLabel("Message the assistant").fill(`status of the deal "QA partner deal ${run}"`);
  await ppanel.getByRole("button", { name: "Send", exact: true }).click();
  await ppanel.getByText(/is at qualification/).waitFor({ timeout: 20000 });
  await ppanel.getByLabel("Message the assistant").fill("How does our commission agreement work?");
  await ppanel.getByRole("button", { name: "Send", exact: true }).click();
  await ppanel.getByText(/You earn 10\.00% of each deal/).waitFor({ timeout: 20000 });
  await ppanel.getByLabel("Message the assistant").fill("Can you help with something unusual?");
  await ppanel.getByRole("button", { name: "Send", exact: true }).click();
  await ppanel.getByRole("button", { name: "Send this to my partner manager" }).click();
  await ppanel.getByText("Sent to your partner manager").waitFor({ timeout: 20000 });
  const messages = await must(db.from("partner_message").select("body").eq("partnerId", ids.partner), "Partner messages");
  assert.ok(messages.some((m) => m.body.includes("From the portal assistant")));
  await db.from("notification").update({ emailStatus: "SKIPPED" }).eq("userId", ids.staff);
  pass("The partner assistant shows deals, a deal's status and the commission terms, and passes a question to the partner manager");

  const partnerUser = await signedIn(sellerUser);
  await partnerUser.goto(`${base}/portal`, { waitUntil: "networkidle" });
  await partnerUser.getByRole("button", { name: "Ask the assistant" }).click();
  const upanel = partnerUser.getByRole("region", { name: "Portal assistant" });
  await upanel.getByRole("button", { name: "What commission is pending?" }).click();
  await upanel.getByText("Commission is shown to your company's portal Admins").waitFor({ timeout: 20000 });
  pass("A partner User asking about commission is pointed to their Admins");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} catch (err) {
  console.error(`Screenshots of each signed-in page are in ${tmpdir()}.`);
  for (const [i, p] of pages.entries()) await p.screenshot({ path: join(tmpdir(), `remaining-items-${i}.png`), fullPage: true }).catch(() => {});
  throw err;
} finally {
  if (browser) await browser.close().catch(() => {});
  receiver.close();
  const failures = [];
  const clean = async (what, fn) => {
    try {
      const r = await fn();
      if (r?.error) failures.push(`${what}: ${r.error.message}`);
    } catch (err) {
      failures.push(`${what}: ${err.message}`);
    }
  };
  const allContacts = [ids.contact, ids.dupContact, ids.buyer, ids.seller, ids.sellerUser];
  const allAccounts = [ids.account, ids.dupAccount, ids.partnerAccount];
  await clean("integration log", () => db.from("integration_log").delete().in("webhookId", ids.webhooks.length ? ids.webhooks : [randomUUID()]));
  await clean("integration log (lead)", () => db.from("integration_log").delete().in("relatedEntityId", [ids.hookLead, ids.lead]));
  await clean("webhooks", () => db.from("webhook").delete().in("id", ids.webhooks.length ? ids.webhooks : [randomUUID()]));
  await clean("partner messages", () => db.from("partner_message").delete().eq("partnerId", ids.partner));
  await clean("favourites", () => db.from("favorite_record").delete().in("userId", [ids.staff, ...ids.logins].filter(Boolean)));
  await clean("preferences", () => db.from("user_preference").delete().in("userId", [ids.staff, ...ids.logins].filter(Boolean)));
  await clean("record merges", () => db.from("record_merge").delete().in("survivorId", [...allAccounts, ...allContacts]));
  await clean("case comments", () => db.from("case_comment").delete().in("caseId", [ids.caseId, ...caseIdsRaised]));
  await clean("cases", () => db.from("support_case").delete().in("id", [ids.caseId, ...caseIdsRaised]));
  await clean("cases by account", () => db.from("support_case").delete().in("accountId", allAccounts));
  await clean("article", () => db.from("knowledge_article").delete().eq("id", ids.article));
  await clean("project", () => db.from("project").delete().eq("id", ids.project));
  await clean("commission", () => db.from("partner_commission").delete().in("opportunityId", [ids.deal, ids.dupDeal, ids.partnerDeal]));
  await clean("deal lines", () => db.from("opportunity_product").delete().in("opportunityId", [ids.deal, ids.dupDeal, ids.partnerDeal]));
  await clean("deals", () => db.from("opportunity").delete().in("id", [ids.deal, ids.dupDeal, ids.partnerDeal]));
  await clean("leads", () => db.from("lead").delete().in("id", [ids.lead, ids.hookLead]));
  await clean("product", () => db.from("product").delete().eq("id", ids.product));
  await clean("notifications", () => db.from("notification").delete().in("userId", [ids.staff, ...ids.logins].filter(Boolean)));
  await clean("follows", () => db.from("record_follow").delete().in("userId", [ids.staff, ...ids.logins].filter(Boolean)));
  await clean("recent", () => db.from("recent_record").delete().in("userId", [ids.staff, ...ids.logins].filter(Boolean)));
  const portalLogins = ids.logins.filter((id) => id !== ids.staff);
  const removeLogin = async (id) => {
    await clean("sign-ins", () => db.from("login_event").delete().eq("userId", id));
    await clean("login", () => db.from("app_user").delete().eq("id", id));
    await db.auth.admin.deleteUser(id).catch(() => {});
  };
  for (const id of portalLogins) await removeLogin(id);
  await clean("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await clean("contacts (merged first)", () => db.from("contact").delete().in("id", allContacts).not("mergedIntoId", "is", null));
  await clean("contacts", () => db.from("contact").delete().in("accountId", allAccounts));
  await clean("accounts (merged first)", () => db.from("account").delete().in("id", allAccounts).not("mergedIntoId", "is", null));
  await clean("accounts", () => db.from("account").delete().in("id", allAccounts));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [...allAccounts, ...allContacts, ids.deal, ids.dupDeal, ids.partnerDeal, ids.project, ids.caseId, ids.lead, ids.hookLead, ids.article, ids.partner, ...caseIdsRaised, ...ids.logins]));
  if (ids.staff) await removeLogin(ids.staff);
  await clean("role", () => db.from("security_role").delete().eq("id", ids.role));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
