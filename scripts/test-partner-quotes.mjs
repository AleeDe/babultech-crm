// A partner pricing a deal and quoting it, with one of our approvers in the
// loop, signed in against the real database. Temporary identities; never
// prints secrets.
//
// The boundary is what matters: a partner sells BabulTech's items and their
// own, never another partner's; their quote reaches the customer only once we
// approve it; and once the customer accepts, the deal is what was accepted.
// Two partners, because isolation faults hide when there is only one.
//
// Usage: node scripts/test-partner-quotes.mjs
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
config({ path: ".env", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const now = () => new Date().toISOString();
const today = new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const passed = [];
const pass = (name) => { passed.push(name); console.log(`PASS ${name}`); };
async function check(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
async function refused(result, what, pattern) {
  const r = await result;
  assert.ok(r.error, `${what} should have been refused`);
  if (pattern) assert.match(r.error.message, pattern, `${what}: ${r.error.message}`);
  return r.error;
}

const ids = {
  partners: [], partnerAccounts: [], people: [], logins: [],
  role: randomUUID(),
  customer: randomUUID(), rivalCustomer: randomUUID(), contact: randomUUID(),
  deal: randomUUID(), rivalDeal: randomUUID(),
  ours: randomUUID(), mine: randomUUID(), rivals: randomUUID(),
  book: randomUUID(), entryOurs: randomUUID(), entryRivals: randomUUID(),
};

async function signIn(email, password) {
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const r = await client.auth.signInWithPassword({ email, password });
  if (r.error) throw new Error(`Sign in: ${r.error.message}`);
  return client;
}

async function makeLogin(email, fields) {
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(`Create identity: ${auth.error.message}`);
  ids.logins.push(auth.data.user.id);
  await check(db.from("app_user").insert({
    id: auth.data.user.id, email, status: "ACTIVE", updatedAt: now(), ...fields,
  }), `Create the login for ${fields.fullName}`);
  return signIn(email, password);
}

async function makePartner(label, owner) {
  const account = randomUUID();
  const partner = randomUUID();
  const person = randomUUID();
  await check(db.from("account").insert({
    id: account, accountNumber: `QAPQ-${label}-${run}`, name: `QA Quotes ${label} ${run}`,
    accountType: "PARTNER", ownerUserId: owner, updatedAt: now(),
  }), `Create ${label}'s company`);
  ids.partnerAccounts.push(account);
  await check(db.from("contact").insert({
    id: person, accountId: account, firstName: label, lastName: `Person ${run}`,
    email: `qa-pq-${label.toLowerCase()}-${run}@example.com`, updatedAt: now(),
  }), `Create ${label}'s person`);
  ids.people.push(person);
  await check(db.from("partner").insert({
    id: partner, partnerNumber: `QAPQP-${label}-${run}`, displayName: `QA Quotes ${label} ${run}`,
    kind: "COMPANY", accountId: account, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: owner, defaultCommissionPercent: 10, updatedAt: now(),
  }), `Create partner ${label}`);
  ids.partners.push(partner);
  const role = await check(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const client = await makeLogin(`qa-pq-${label.toLowerCase()}-${run}@example.com`, {
    fullName: `QA ${label} ${run}`, roleId: role.id, userType: "PARTNER", portalRole: "ADMIN", partnerId: partner, contactId: person,
  });
  return { partner, account, client };
}

const line = (productId, entryId, quantity, unitPrice, extra = {}) => ({
  productId, priceBookEntryId: entryId, quantity, unitPrice,
  licenseCost: 0, maintenanceCost: 0, cloudCost: 0, aiCost: 0, discountPercent: 0, taxRateId: null, ...extra,
});

try {
  const owner = (await check(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  )).id;
  const me = await makePartner("Mine", owner);
  const rival = await makePartner("Rival", owner);

  // One of our approvers: may approve quotations and see every deal.
  await check(db.from("security_role").insert({
    id: ids.role, name: `QA Quote Approver ${run}`, dataScope: "ALL", updatedAt: now(),
    permissions: ["quotation:approve", "opportunity:read", "opportunity:write", "account:read"],
  }), "Create the approver role");
  const approver = await makeLogin(`qa-pq-approver-${run}@example.com`, {
    fullName: `QA Approver ${run}`, roleId: ids.role, userType: "INTERNAL",
  });

  await check(db.from("account").insert([
    { id: ids.customer, accountNumber: `QAPQ-C-${run}`, name: `QA Quotes Customer ${run}`, accountType: "PROSPECT", ownerUserId: owner, sourcePartnerId: me.partner, updatedAt: now() },
    { id: ids.rivalCustomer, accountNumber: `QAPQ-RC-${run}`, name: `QA Quotes Rival Customer ${run}`, accountType: "PROSPECT", ownerUserId: owner, sourcePartnerId: rival.partner, updatedAt: now() },
  ]), "Create the customers");
  await check(db.from("contact").insert({
    id: ids.contact, accountId: ids.customer, firstName: "Hamid", lastName: `Buyer ${run}`,
    email: `qa-pq-hamid-${run}@example.com`, isPrimary: true, sourcePartnerId: me.partner, updatedAt: now(),
  }), "Create the customer's contact");
  await check(db.from("opportunity").insert([
    { id: ids.deal, opportunityNumber: `QAPQ-D1-${run}`, name: `QA Quotes Deal ${run}`, accountId: ids.customer, ownerUserId: owner, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: me.partner, updatedAt: now() },
    { id: ids.rivalDeal, opportunityNumber: `QAPQ-D2-${run}`, name: `QA Quotes Rival Deal ${run}`, accountId: ids.rivalCustomer, ownerUserId: owner, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: rival.partner, updatedAt: now() },
  ]), "Create the deals");

  // Our item (no owner given: it becomes BabulTech's), the partner's, the rival's.
  await check(db.from("product").insert([
    { id: ids.ours, productCode: "auto", name: `QA Quotes Ours ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now() },
    { id: ids.mine, productCode: "auto", name: `QA Quotes Mine ${run}`, productType: "PRODUCT", addInTask: false, active: true, ownerAccountId: me.account, updatedAt: now() },
    { id: ids.rivals, productCode: "auto", name: `QA Quotes Rivals ${run}`, productType: "PRODUCT", addInTask: false, active: true, ownerAccountId: rival.account, updatedAt: now() },
  ]), "Create the items");
  await check(db.from("price_book").insert({
    id: ids.book, name: `QA Quotes Book ${run}`, currencyCode: "PKR", active: true, updatedAt: now(),
  }), "Create a price book");
  await check(db.from("price_book_entry").insert([
    { id: ids.entryOurs, priceBookId: ids.book, productId: ids.ours, quantity: 1, rate: 1000, licenseCost: 100, maintenanceCost: 0, cloudCost: 0, aiCost: 0, active: true, updatedAt: now() },
    { id: ids.entryRivals, priceBookId: ids.book, productId: ids.rivals, quantity: 1, rate: 50, licenseCost: 0, maintenanceCost: 0, cloudCost: 0, aiCost: 0, active: true, updatedAt: now() },
  ]), "Price them");

  // --- 1. What the partner may read -----------------------------------------

  const products = await check(me.client.from("product").select("id").in("id", [ids.ours, ids.mine, ids.rivals]), "Read items as the partner");
  assert.deepEqual(products.map((p) => p.id).sort(), [ids.ours, ids.mine].sort(), "BabulTech's item and their own, not the rival's");
  const books = await check(me.client.from("price_book").select("id").eq("id", ids.book), "Read the price book");
  assert.equal(books.length, 1, "The active price book is readable");
  const entries = await check(me.client.from("price_book_entry").select("id").eq("priceBookId", ids.book), "Read its prices");
  assert.deepEqual(entries.map((e) => e.id), [ids.entryOurs], "Only the prices of items they may sell");
  await refused(me.client.from("price_book").update({ name: "Taken" }).eq("id", ids.book).select("id").then((r) =>
    r.error || r.data?.length ? r : { error: { message: "no rows changed" } }), "Changing the price book");
  const rivalSees = await check(rival.client.from("product").select("id").eq("id", ids.mine), "Read the partner's item as the rival");
  assert.equal(rivalSees.length, 0, "The rival never sees the partner's own item");
  pass("Sees BabulTech's items and their own, their prices, never the rival's; books are read-only");

  // --- 2. Add Product & Service ---------------------------------------------

  // 2 x 1000 + 100 licence, less 10% = 1890; 1 x 500 = 500. 2390 in all.
  const lines = [
    line(ids.ours, ids.entryOurs, 2, 1000, { licenseCost: 100, discountPercent: 10 }),
    line(ids.mine, null, 1, 500),
  ];
  const saved = await check(me.client.rpc("partner_save_opportunity_lines", {
    p_opportunity: ids.deal, p_price_book: ids.book, p_lines: lines,
  }), "Price the deal");
  assert.equal(Number(saved.amount), 2390);
  const myLines = await check(me.client.from("opportunity_product").select("id").eq("opportunityId", ids.deal), "Read the lines");
  assert.equal(myLines.length, 2);
  const rivalLines = await check(rival.client.from("opportunity_product").select("id").eq("opportunityId", ids.deal), "Read them as the rival");
  assert.equal(rivalLines.length, 0, "The rival cannot read the partner's lines");
  await refused(me.client.rpc("partner_save_opportunity_lines", {
    p_opportunity: ids.deal, p_price_book: ids.book, p_lines: [...lines, line(ids.rivals, ids.entryRivals, 1, 50)],
  }), "Selling the rival's item", /not one you can sell/i);
  await refused(rival.client.rpc("partner_save_opportunity_lines", {
    p_opportunity: ids.deal, p_price_book: ids.book, p_lines: lines,
  }), "The rival pricing the partner's deal", /not one of yours/i);
  await refused(me.client.rpc("save_opportunity_lines", {
    p_opportunity: ids.deal, p_price_book: ids.book, p_lines: lines,
  }), "The partner using our line save", /not permitted/i);
  const direct = await me.client.from("opportunity_product").insert({ opportunityId: ids.deal, productId: ids.ours, quantity: 1, unitPrice: 1, sortOrder: 9 }).select("id");
  assert.ok(direct.error || !direct.data?.length, "A line is never written straight to the table");
  pass("Prices their deal from the book: 2390; not with the rival's item, not the rival's deal, not directly");

  // --- 3. A quote, and its approval -----------------------------------------

  const header = {
    contactId: ids.contact, quoteDate: today, expiryDate: inDays(30), currencyCode: "PKR",
    priceBookId: ids.book, paymentTerms: "50% on order",
  };
  const created = await check(me.client.rpc("partner_create_quotation", {
    p_opportunity: ids.deal, p_quote: header, p_lines: lines,
  }), "Create a quote");
  const quoteId = created.id;
  const q1 = await check(me.client.from("quotation").select("status, approvalStatus, preparedByPartnerId, totalAmount").eq("id", quoteId).single(), "Read the quote");
  assert.equal(q1.status, "DRAFT");
  assert.equal(q1.preparedByPartnerId, me.partner);
  assert.equal(Number(q1.totalAmount), 2390);
  const qLines = await check(me.client.from("quote_line").select("id, description").eq("quotationId", quoteId), "Read its lines");
  assert.equal(qLines.length, 2);
  const rivalQuote = await check(rival.client.from("quote_line").select("id").eq("quotationId", quoteId), "Read them as the rival");
  assert.equal(rivalQuote.length, 0, "The rival cannot read the partner's quote lines");
  await refused(me.client.rpc("partner_send_quotation", { p_id: quoteId }), "Sending before approval", /approval before it goes to the customer/i);
  pass(`Quote ${created.quoteNumber} created as the partner's draft, 2390; it cannot be sent unapproved`);

  await check(me.client.rpc("partner_request_quotation_approval", { p_id: quoteId }), "Ask for approval");
  await refused(me.client.rpc("decide_quotation_approval", { p_id: quoteId, p_approve: true }), "The partner approving it", /not permitted/i);
  await refused(approver.rpc("decide_quotation_approval", { p_id: quoteId, p_approve: false, p_note: " " }), "Sending back with no reason", /why it is being sent back/i);
  await check(approver.rpc("decide_quotation_approval", { p_id: quoteId, p_approve: false, p_note: "The discount is too deep" }), "Send it back");
  const back = await check(me.client.from("quotation").select("status, approvalStatus, approvalNote").eq("id", quoteId).single(), "Read it back");
  assert.equal(back.status, "DRAFT");
  assert.equal(back.approvalStatus, "REJECTED");
  assert.equal(back.approvalNote, "The discount is too deep", "The partner sees why");
  lines[0].discountPercent = 5;
  await check(me.client.rpc("partner_update_quotation", { p_id: quoteId, p_quote: header, p_lines: lines }), "Change it");
  await check(me.client.rpc("partner_request_quotation_approval", { p_id: quoteId }), "Ask again");
  await check(approver.rpc("decide_quotation_approval", { p_id: quoteId, p_approve: true }), "Approve it");
  const approved = await check(me.client.from("quotation").select("status, approvalStatus, totalAmount").eq("id", quoteId).single(), "Read it approved");
  assert.equal(approved.status, "APPROVED");
  assert.equal(Number(approved.totalAmount), 2495, "2 x 1000 + 100, less 5%, + 500");
  pass("Sent back with a reason the partner reads; changed, asked again, approved by us - never by the partner");

  // --- 4. Sent, accepted, won -----------------------------------------------

  await check(me.client.rpc("partner_send_quotation", { p_id: quoteId }), "Send it");
  const moved = await check(me.client.from("opportunity").select("stage").eq("id", ids.deal).single(), "Read the deal");
  assert.equal(moved.stage, "QUOTE_SUBMITTED", "Sending moves the deal on");
  await check(me.client.rpc("partner_decide_quotation", { p_id: quoteId, p_accepted: true }), "Record the acceptance");
  const acceptedDeal = await check(db.from("opportunity").select("amount, stage").eq("id", ids.deal).single(), "Read the deal");
  assert.equal(Number(acceptedDeal.amount), 2495, "The deal is now what the customer accepted");
  assert.equal(acceptedDeal.stage, "VERBAL_CONFIRMATION");
  await refused(me.client.rpc("partner_save_opportunity_lines", {
    p_opportunity: ids.deal, p_price_book: ids.book, p_lines: [line(ids.ours, ids.entryOurs, 99, 1000)],
  }), "Changing what was sold after acceptance", /customer accepted/i);
  await refused(me.client.rpc("partner_revise_quotation", { p_id: quoteId }), "Revising the accepted quote", /cannot be revised/i);
  const won = await check(me.client.rpc("partner_set_opportunity_stage", { p_id: ids.deal, p_stage: "CLOSED_WON" }), "Win the deal");
  assert.ok(won.projectNumber, "Winning starts the delivery project");
  const commission = await check(me.client.from("partner_commission").select("baseAmount, paymentDate").eq("opportunityId", ids.deal).single(), "Read the commission");
  assert.equal(Number(commission.baseAmount), 2495, "Commission is paid on the accepted amount");
  pass(`Sent, accepted and won on 2495; the lines are then fixed; project ${won.projectNumber}, commission on 2495`);

  console.log(`\n${passed.length} checks passed.`);
} finally {
  const failures = [];
  const step = async (what, fn) => {
    try {
      const r = await fn();
      if (r?.error) failures.push(`${what}: ${r.error.message}`);
    } catch (err) {
      failures.push(`${what}: ${err.message}`);
    }
  };
  const deals = [ids.deal, ids.rivalDeal];
  await step("commission history", async () => {
    const { data } = await db.from("partner_commission").select("id").in("opportunityId", deals);
    const recordIds = (data ?? []).map((r) => r.id);
    return recordIds.length ? db.from("audit_history").delete().in("entityId", recordIds) : { error: null };
  });
  await step("projects", async () => {
    const { data } = await db.from("project").select("id").in("opportunityId", deals);
    const projectIds = (data ?? []).map((p) => p.id);
    if (!projectIds.length) return { error: null };
    await db.from("project_task").delete().in("projectId", projectIds);
    await db.from("project_member").delete().in("projectId", projectIds);
    return db.from("project").delete().in("id", projectIds);
  });
  let quoteIds = [];
  await step("quotes", async () => {
    const { data } = await db.from("quotation").select("id").in("opportunityId", deals);
    quoteIds = (data ?? []).map((q) => q.id);
    if (!quoteIds.length) return { error: null };
    await db.from("quote_line").delete().in("quotationId", quoteIds);
    return db.from("quotation").delete().in("id", quoteIds);
  });
  await step("deal lines", () => db.from("opportunity_product").delete().in("opportunityId", deals));
  await step("deals", () => db.from("opportunity").delete().in("id", deals));
  await step("prices", () => db.from("price_book_entry").delete().eq("priceBookId", ids.book));
  await step("price book", () => db.from("price_book").delete().eq("id", ids.book));
  await step("items", () => db.from("product").delete().in("id", [ids.ours, ids.mine, ids.rivals]));
  for (const id of ids.logins) {
    await step("login", () => db.from("app_user").delete().eq("id", id));
    await step("identity", () => db.auth.admin.deleteUser(id));
  }
  await step("role", () => db.from("security_role").delete().eq("id", ids.role));
  await step("contacts", () => db.from("contact").delete().in("id", [ids.contact, ...ids.people]));
  await step("accounts", () => db.from("account").delete().in("id", [ids.customer, ids.rivalCustomer]));
  await step("partners", () => db.from("partner").delete().in("id", ids.partners));
  await step("partner companies", () => db.from("account").delete().in("id", ids.partnerAccounts));
  await step("audit", () => db.from("audit_history").delete().in("entityId", [...deals, ...quoteIds, ids.customer]));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
