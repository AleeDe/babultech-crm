// The whole partner story, from a lead to money in their hand.
//
// A partner arrives as a lead like anybody else. It converts to an account of
// type Partner with a contact. We make them a partner at a rate, give that
// contact a portal login. They sign in, bring us a customer, raise a deal - and
// the deal has a commission record from that moment, at their rate, which they
// can see. The record follows the deal as it is priced. The partner asks for a
// better rate; we decline, then approve a second request. The deal is won, the
// payment date lands 90 days out, and the partner marks it paid once the money
// reaches them. After that nothing about it can change.
//
// Around that: a lost deal rejects its commission and a reopened one brings it
// back, a person's rejection is final, a deal with no partner can be given one
// once, a lead referred by a partner carries them to the deal, and a partner
// never sees another partner's commission.
//
// The arithmetic is checked at every step against a figure worked out here,
// not read back from the same place that wrote it.
//
// Cleans up after itself.
//
// Usage: node scripts/test-lead-to-commission.mjs
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
config({ path: ".env", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 6).toUpperCase();
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const digits = () => String(Math.floor(Math.random() * 9e6) + 1e6);

const passed = [];

/**
 * What the run created, and the order to remove it in. Foreign keys decide the
 * order: an account names the staff member who owns it, a portal login names
 * both its partner and its contact.
 */
const ids = {
  authUsers: [], appUsers: [], partnerLogins: [], roles: [],
  leads: [], accounts: [], partners: [], products: [], projects: [], priceBooks: [],
  opportunities: [],
  teardown() {
    const del = (table, column, values) => async () =>
      values.length ? admin.from(table).delete().in(column, values) : { error: null };
    return [
      async () => {
        const { data } = await admin.from("partner_commission").select("id").in("opportunityId", this.opportunities.length ? this.opportunities : ["00000000-0000-0000-0000-000000000000"]);
        const pcIds = (data ?? []).map((r) => r.id);
        return pcIds.length ? admin.from("audit_history").delete().in("entityId", pcIds) : { error: null };
      },
      del("project_task", "projectId", this.projects),
      del("project_member", "projectId", this.projects),
      del("project", "id", this.projects),
      // Deleting a deal takes its lines and its commission record with it.
      del("opportunity_product", "opportunityId", this.opportunities),
      del("opportunity", "id", this.opportunities),
      del("lead", "id", this.leads),
      del("price_book_entry", "priceBookId", this.priceBooks),
      del("price_book", "id", this.priceBooks),
      del("product", "id", this.products),
      del("app_user", "id", this.partnerLogins),
      del("partner", "id", this.partners),
      del("contact", "accountId", this.accounts),
      del("account", "id", this.accounts),
      del("app_user", "id", this.appUsers),
      del("security_role", "id", this.roles),
      async () => {
        for (const id of this.authUsers) {
          const r = await admin.auth.admin.deleteUser(id);
          if (r.error && !/not found/i.test(r.error.message)) return { error: r.error };
        }
        return { error: null };
      },
    ];
  },
};
const pass = (n) => { passed.push(n); console.log(`  PASS  ${n}`); };
const step = (n, s) => console.log(`\n${n}  ${s}\n${"─".repeat(64)}`);

async function ok(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
/** The call must be refused, and the refusal should say why. */
async function refused(result, pattern, what) {
  const r = await result;
  assert.ok(r.error, `${what} must be refused`);
  if (pattern) assert.match(r.error.message, pattern, `${what}: the refusal should say why (got "${r.error.message}")`);
  return r.error.message;
}
const parse = (d) => (typeof d === "string" ? JSON.parse(d) : d);
const money = (v) => Number(v ?? 0);
const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 });
const round2 = (n) => Math.round(n * 100) / 100;

// The agreement, written here once so every assertion below is checked against
// a number this file decided rather than one the database handed back.
const RATE = 25;          // per cent commission
const WITHHOLDING = 10;   // per cent tax withheld from it
const HOURS = 160;
const RATE_PER_HOUR = 5000;
const DEAL = HOURS * RATE_PER_HOUR;   // 800,000

function expected(base, rate) {
  const commission = round2((base * rate) / 100);
  const withheld = round2((commission * WITHHOLDING) / 100);
  return { commission, withheld, paid: round2(commission - withheld) };
}

console.log(`\nPartner commission, end to end   ·   run ${run}`);
console.log(`Agreement: ${RATE}% of the deal, less ${WITHHOLDING}% withholding\n`);

try {
  // ═══════════════════════════════════════════════════════════════════════
  step("00", "The people who will do the work");
  // ═══════════════════════════════════════════════════════════════════════

  // A role of our own, holding exactly what a salesperson who decides
  // commission holds - rather than borrowing Super Admin, which would pass
  // every check whether or not the rules were right.
  const roleId = randomUUID();
  await ok(
    admin.from("security_role").insert({
      id: roleId, name: `L2C sales ${run}`, dataScope: "ALL", updatedAt: now(),
      permissions: [
        "lead:read", "lead:write", "account:read", "account:write",
        "opportunity:read", "opportunity:write", "partner:read", "partner:write",
        "commission:read", "commission:approve", "project:read",
      ],
    }),
    "Create the sales role",
  );
  ids.roles.push(roleId);

  async function makeUser(label, role, extra = {}) {
    const address = `l2c-${label}-${run.toLowerCase()}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const auth = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
    if (auth.error) throw auth.error;
    const id = auth.data.user.id;
    ids.authUsers.push(id);
    await ok(
      admin.from("app_user").insert({
        id, fullName: `L2C ${label} ${run}`, email: address, roleId: role,
        userType: extra.partnerId ? "PARTNER" : "INTERNAL",
        // The partner's own login is its Admin, who alone sees commission (since 1 October).
        ...(extra.partnerId ? { portalRole: "ADMIN" } : {}),
        status: "ACTIVE", updatedAt: now(), ...extra,
      }),
      `Create ${label}`,
    );
    (extra.partnerId ? ids.partnerLogins : ids.appUsers).push(id);
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const si = await client.auth.signInWithPassword({ email: address, password });
    if (si.error) throw new Error(`${label} sign-in: ${si.error.message}`);
    return { id, client };
  }

  const sales = await makeUser("sales", roleId);
  pass("A salesperson who decides commission signed in");

  // ═══════════════════════════════════════════════════════════════════════
  step("01", "A partner arrives as a lead, and becomes a partner");
  // ═══════════════════════════════════════════════════════════════════════

  const leadId = randomUUID();
  await ok(
    sales.client.from("lead").insert({
      id: leadId, leadNumber: `L2CL-${run}`,
      firstName: "Sana", lastName: `Rauf ${run}`,
      companyName: `L2C Nexus Systems ${run}`,
      email: `l2c-sana-${run.toLowerCase()}@example.com`,
      phone: `0321 ${digits()}`,
      leadType: "PARTNER", status: "QUALIFIED", rating: "HOT", leadSource: "Referral",
      ownerUserId: sales.id, updatedAt: now(),
    }),
    "Create the partner lead",
  );
  ids.leads.push(leadId);

  const converted = parse(await ok(
    sales.client.rpc("convert_lead", {
      p_lead_id: leadId, p_actor_id: sales.id, p_account_id: null,
      p_create_opportunity: true, p_opportunity_name: `Should not be created ${run}`,
      p_amount: 1, p_expected_close: inDays(30),
      p_registered_at: null, p_expires_at: null, p_protection_days: null,
    }),
    "Convert the lead",
  ));
  ids.accounts.push(converted.accountId);
  const partnerAccount = await ok(
    admin.from("account").select("accountType").eq("id", converted.accountId).single(),
    "Read the converted account",
  );
  assert.equal(partnerAccount.accountType, "PARTNER", "A partner lead must convert to a PARTNER account");
  assert.equal(converted.opportunityId, null, "A partner lead must not open a pipeline deal");
  pass("Partner lead converted to a Partner account, with no deal");

  const partnerId = randomUUID();
  await ok(
    sales.client.from("partner").insert({
      id: partnerId, partnerNumber: `L2CP-${run}`,
      displayName: `L2C Nexus Systems ${run}`, kind: "COMPANY",
      accountId: converted.accountId, contactId: null,
      partnerType: "REFERRAL", tier: "GOLD", status: "ACTIVE",
      partnerManagerId: sales.id,
      defaultCommissionPercent: RATE, withholdingTaxPercent: WITHHOLDING,
      payoutCurrencyCode: "PKR", startDate: today(), updatedAt: now(),
    }),
    "Create the partner",
  );
  ids.partners.push(partnerId);

  const partnerRole = await ok(
    admin.from("security_role").select("id").eq("name", "Partner").single(),
    "Find the Partner role",
  );
  const partner = await makeUser("partner", partnerRole.id, { partnerId, contactId: converted.contactId });
  pass(`Partner at ${RATE}% with ${WITHHOLDING}% withholding, and a portal login for their contact`);

  // ═══════════════════════════════════════════════════════════════════════
  step("02", "The partner brings a customer and raises a deal");
  // ═══════════════════════════════════════════════════════════════════════

  const customer = parse(await ok(
    partner.client.rpc("partner_create_customer", {
      p_account_name: `L2C Meridian Foods ${run}`,
      p_first_name: "Imran", p_last_name: `Khalid ${run}`,
      p_email: `l2c-imran-${run.toLowerCase()}@example.com`, p_phone: `0300 ${digits()}`,
      p_job_title: "Operations Director", p_industry: "Food", p_city: "Lahore",
      p_website: null, p_deal_name: null, p_deal_amount: null, p_deal_close: null,
      p_deal_currency: "PKR", p_notes: "Three sites.",
    }),
    "Create the customer as the partner",
  ));
  ids.accounts.push(customer.accountId);

  const deal = parse(await ok(
    partner.client.rpc("partner_add_opportunity", {
      p_account_id: customer.accountId, p_name: `L2C Warehouse rollout ${run}`,
      p_amount: 500000, p_close_date: inDays(20), p_currency: "PKR",
      p_contact_id: customer.contactId, p_notes: null, p_deal_type: "NEW",
      p_next_step: "Contract review", p_competitor: null,
      p_new_first: null, p_new_last: null, p_new_title: null, p_new_email: null, p_new_phone: null,
      p_street: null, p_city: null, p_state: null, p_postal_code: null, p_country: null,
      p_probability: 70, p_lead_source: "Referral",
    }),
    "Add the opportunity",
  ));
  const opportunityId = deal.opportunityId;
  ids.opportunities.push(opportunityId);

  const readRecord = async () => ok(
    admin.from("partner_commission").select("*").eq("opportunityId", opportunityId).single(),
    "Read the commission record",
  );

  let pc = await readRecord();
  let e = expected(500000, RATE);
  assert.equal(pc.partnerId, partnerId, "The record names the partner");
  assert.equal(pc.status, "IN_PROGRESS", "It starts in progress");
  assert.equal(pc.paymentDate, null, "No payment date while the deal is open");
  assert.equal(money(pc.commissionPercent), RATE, "At the partner's rate");
  assert.equal(money(pc.commissionAmount), e.commission, "Commission is rate x deal amount");
  assert.equal(money(pc.withholdingAmount), e.withheld, "Withholding is taken from the commission");
  assert.equal(money(pc.partnerAmount), e.paid, "The partner is paid the rest");
  assert.match(pc.commissionNumber, /^PC-\d{6}$/, "Numbered PC-000000");
  pass(`Commission record ${pc.commissionNumber} created with the deal: ${fmt(e.commission)} less ${fmt(e.withheld)} = ${fmt(e.paid)}`);

  const theirs = await ok(
    partner.client.from("partner_commission").select("id, partnerAmount").eq("opportunityId", opportunityId),
    "Read it as the partner",
  );
  assert.equal(theirs.length, 1, "The partner can see their own commission");
  pass("The partner sees it in their portal from the first day");

  // ═══════════════════════════════════════════════════════════════════════
  step("03", "It follows the deal as the deal is priced");
  // ═══════════════════════════════════════════════════════════════════════

  const productId = randomUUID();
  await ok(
    admin.from("product").insert({
      id: productId, productCode: "pending", name: `Warehouse rollout ${run}`,
      productType: "SERVICE", addInTask: true, active: true, updatedAt: now(),
    }),
    "Create the service being sold",
  );
  ids.products.push(productId);
  const bookId = randomUUID();
  await ok(
    admin.from("price_book").insert({ id: bookId, name: `L2C rates ${run}`, currencyCode: "PKR", active: true, updatedAt: now() }),
    "Create a price book",
  );
  ids.priceBooks.push(bookId);
  const entry = await ok(
    admin.from("price_book_entry").insert({ priceBookId: bookId, productId, quantity: HOURS, rate: RATE_PER_HOUR }).select("id").single(),
    "Price the service",
  );

  const saved = await ok(
    sales.client.rpc("save_opportunity_lines", {
      p_opportunity: opportunityId, p_price_book: bookId,
      p_lines: [{
        productId, priceBookEntryId: entry.id, quantity: HOURS, unitPrice: RATE_PER_HOUR,
        licenseCost: 0, maintenanceCost: 0, cloudCost: 0, aiCost: 0, discountPercent: 0,
      }],
    }),
    "Price the deal",
  );
  assert.equal(money(saved.amount), DEAL, "The deal is its lines' total");
  pc = await readRecord();
  e = expected(DEAL, RATE);
  assert.equal(money(pc.baseAmount), DEAL, "The record follows the deal amount");
  assert.equal(money(pc.partnerAmount), e.paid, "And the partner's figure with it");
  pass(`Deal priced at ${fmt(DEAL)} from its line; the partner's figure follows to ${fmt(e.paid)}`);

  // ═══════════════════════════════════════════════════════════════════════
  step("04", "The partner asks for a better rate");
  // ═══════════════════════════════════════════════════════════════════════

  await refused(
    partner.client.rpc("partner_commission_request_percent", { p_id: pc.id, p_percent: 30, p_reason: "" }),
    /why/i, "A request without a reason",
  );
  await ok(
    partner.client.rpc("partner_commission_request_percent", {
      p_id: pc.id, p_percent: 30, p_reason: "We are doing the installation ourselves.",
    }),
    "Ask for 30%",
  );
  pc = await readRecord();
  assert.equal(pc.requestStatus, "PENDING", "The request waits");
  assert.equal(money(pc.commissionPercent), RATE, "The rate does not change until it is approved");
  pass("Request for 30% waiting; the rate stays at 25% meanwhile");

  await refused(
    partner.client.rpc("partner_commission_request_percent", { p_id: pc.id, p_percent: 35, p_reason: "More" }),
    /already have a request/i, "A second request while one is waiting",
  );
  await refused(
    sales.client.rpc("partner_commission_change_percent", { p_id: pc.id, p_percent: 20, p_reason: "Ours" }),
    /answer|approve or decline/i, "Changing the rate over an unanswered request",
  );
  await refused(
    sales.client.rpc("partner_commission_decide_request", { p_id: pc.id, p_approve: false, p_reason: null }),
    /reason/i, "Declining without a reason",
  );
  pass("One request at a time; it must be answered, and a no needs a reason");

  await ok(
    sales.client.rpc("partner_commission_decide_request", {
      p_id: pc.id, p_approve: false, p_reason: "Installation is priced separately on this deal.",
    }),
    "Decline",
  );
  pc = await readRecord();
  assert.equal(pc.requestStatus, "DECLINED");
  assert.equal(money(pc.commissionPercent), RATE, "Declining keeps the rate");
  pass("Declined with a reason; still 25%");

  await ok(
    partner.client.rpc("partner_commission_request_percent", {
      p_id: pc.id, p_percent: 28, p_reason: "Meeting you part of the way.",
    }),
    "Ask again for 28%",
  );
  await ok(
    sales.client.rpc("partner_commission_decide_request", { p_id: pc.id, p_approve: true, p_reason: null }),
    "Approve",
  );
  pc = await readRecord();
  e = expected(DEAL, 28);
  assert.equal(pc.requestStatus, "APPROVED");
  assert.equal(money(pc.commissionPercent), 28, "Approving applies the requested rate");
  assert.equal(money(pc.partnerAmount), e.paid, "And the amounts follow");
  pass(`Second request approved: 28%, the partner is now paid ${fmt(e.paid)}`);

  // ═══════════════════════════════════════════════════════════════════════
  step("05", "Only we reject, and nobody marks an open deal paid");
  // ═══════════════════════════════════════════════════════════════════════

  await refused(
    partner.client.rpc("partner_commission_mark", { p_id: pc.id, p_status: "REJECTED", p_reason: "No" }),
    /only babultech/i, "The partner rejecting",
  );
  await refused(
    partner.client.rpc("partner_commission_mark", { p_id: pc.id, p_status: "PAID", p_reason: null }),
    /once the deal is won/i, "Marking paid before the deal is won",
  );
  await refused(
    partner.client.rpc("partner_commission_set_payment_date", { p_id: pc.id, p_date: inDays(10) }),
    /not permitted/i, "The partner setting the payment date",
  );
  pass("The partner cannot reject, set the date, or mark an open deal paid");

  // ═══════════════════════════════════════════════════════════════════════
  step("06", "The deal is won");
  // ═══════════════════════════════════════════════════════════════════════

  await ok(
    sales.client.from("opportunity")
      .update({ stage: "CLOSED_WON", actualCloseDate: today(), updatedAt: now() })
      .eq("id", opportunityId),
    "Win the deal",
  );
  pc = await readRecord();
  assert.equal(pc.paymentDate, inDays(90), "The payment date is 90 days after the win");
  assert.equal(pc.status, "IN_PROGRESS", "Still in progress: nothing is paid automatically");
  pass(`Won: payment date ${pc.paymentDate}, 90 days out; still in progress`);

  await ok(
    sales.client.rpc("partner_commission_set_payment_date", { p_id: pc.id, p_date: inDays(75) }),
    "Move the payment date",
  );
  pc = await readRecord();
  assert.equal(pc.paymentDate, inDays(75));
  pass("Staff can move the payment date");

  // ═══════════════════════════════════════════════════════════════════════
  step("07", "The partner is paid, and says so");
  // ═══════════════════════════════════════════════════════════════════════

  await ok(
    partner.client.rpc("partner_commission_mark", { p_id: pc.id, p_status: "PAID", p_reason: null }),
    "Mark paid as the partner",
  );
  pc = await readRecord();
  assert.equal(pc.status, "PAID");
  assert.equal(pc.paymentDate, today(), "The payment date becomes the day it was marked paid");
  assert.equal(pc.closedById, partner.id, "And records who said so");
  pass(`Marked paid by the partner; payment date is now today, ${pc.paymentDate}`);

  await refused(
    sales.client.rpc("partner_commission_change_percent", { p_id: pc.id, p_percent: 10, p_reason: "Late change" }),
    /closed/i, "Changing a paid commission",
  );
  await refused(
    sales.client.from("opportunity").update({ stage: "NEGOTIATION", updatedAt: now() }).eq("id", opportunityId),
    /already been paid/i, "Reopening a deal whose commission is paid",
  );
  await ok(
    sales.client.from("opportunity").update({ amount: DEAL + 1, updatedAt: now() }).eq("id", opportunityId),
    "Touch the paid deal's amount",
  ).catch(() => null);
  pc = await readRecord();
  assert.equal(money(pc.baseAmount), DEAL, "A paid record no longer follows the deal");
  pass("Paid is final: no rate change, the deal cannot be reopened, the amount is frozen");

  const history = await ok(
    admin.from("audit_history").select("fieldName, source").eq("entityType", "PartnerCommission").eq("entityId", pc.id),
    "Read the history",
  );
  const fields = history.map((h) => h.fieldName);
  for (const f of ["requestedPercent", "requestStatus", "paymentDate", "status"]) {
    assert.ok(fields.includes(f), `The history records ${f}`);
  }
  assert.ok(history.some((h) => h.source === "portal"), "Partner actions are marked as from the portal");
  pass(`History kept: ${history.length} entries, the partner's marked as from the portal`);

  // ═══════════════════════════════════════════════════════════════════════
  step("08", "Lost, reopened, and rejected");
  // ═══════════════════════════════════════════════════════════════════════

  const second = parse(await ok(
    partner.client.rpc("partner_add_opportunity", {
      p_account_id: customer.accountId, p_name: `L2C Second site ${run}`,
      p_amount: 200000, p_close_date: inDays(40), p_currency: "PKR",
      p_contact_id: customer.contactId, p_notes: null, p_deal_type: "UPSELL",
      p_next_step: null, p_competitor: null,
      p_new_first: null, p_new_last: null, p_new_title: null, p_new_email: null, p_new_phone: null,
      p_street: null, p_city: null, p_state: null, p_postal_code: null, p_country: null,
      p_probability: 30, p_lead_source: "Referral",
    }),
    "Add a second deal",
  ));
  ids.opportunities.push(second.opportunityId);
  const readSecond = async () => ok(
    admin.from("partner_commission").select("*").eq("opportunityId", second.opportunityId).single(),
    "Read the second record",
  );

  await ok(
    sales.client.from("opportunity").update({ stage: "CLOSED_LOST", lossReason: "Budget", actualCloseDate: today(), updatedAt: now() }).eq("id", second.opportunityId),
    "Lose it",
  );
  let pc2 = await readSecond();
  assert.equal(pc2.status, "REJECTED");
  assert.equal(pc2.rejectedReason, "Deal lost");
  pass("A lost deal's commission is rejected: Deal lost");

  await ok(
    sales.client.from("opportunity").update({ stage: "NEGOTIATION", lossReason: null, actualCloseDate: null, updatedAt: now() }).eq("id", second.opportunityId),
    "Reopen it",
  );
  pc2 = await readSecond();
  assert.equal(pc2.status, "IN_PROGRESS", "Reopening brings the commission back");
  pass("Reopened: back in progress");

  await refused(
    sales.client.rpc("partner_commission_mark", { p_id: pc2.id, p_status: "REJECTED", p_reason: " " }),
    /reason/i, "Rejecting without a reason",
  );
  await ok(
    sales.client.rpc("partner_commission_mark", { p_id: pc2.id, p_status: "REJECTED", p_reason: "Sold by our own team in the end." }),
    "Reject it",
  );
  await ok(
    sales.client.from("opportunity").update({ stage: "QUALIFICATION", updatedAt: now() }).eq("id", second.opportunityId),
    "Move the deal again",
  );
  pc2 = await readSecond();
  assert.equal(pc2.status, "REJECTED", "A person's rejection is not undone by the deal moving");
  pass("Rejected by a person, with a reason, and it stays rejected");

  // ═══════════════════════════════════════════════════════════════════════
  step("09", "A deal with no partner, given one once");
  // ═══════════════════════════════════════════════════════════════════════

  const plainAccount = randomUUID();
  await ok(
    admin.from("account").insert({
      id: plainAccount, accountNumber: `L2CA-${run}`, name: `L2C Direct customer ${run}`,
      accountType: "PROSPECT", ownerUserId: sales.id, updatedAt: now(),
    }),
    "Create a customer we found ourselves",
  );
  ids.accounts.push(plainAccount);
  const directDeal = randomUUID();
  await ok(
    sales.client.from("opportunity").insert({
      id: directDeal, opportunityNumber: `L2CO-${run}`, name: `L2C Direct deal ${run}`,
      accountId: plainAccount, ownerUserId: sales.id, amount: 100000, currencyCode: "PKR",
      expectedCloseDate: inDays(30), stage: "DISCOVERY", updatedAt: now(),
    }),
    "Raise a deal with no partner",
  );
  ids.opportunities.push(directDeal);
  let direct = await ok(admin.from("partner_commission").select("id").eq("opportunityId", directDeal), "Look for a record");
  assert.equal(direct.length, 0, "Our own deal has no commission");
  pass("A deal of our own has no commission record");

  await ok(
    sales.client.rpc("set_opportunity_partner", { p_opportunity: directDeal, p_partner: partnerId }),
    "Give it the partner",
  );
  direct = await ok(admin.from("partner_commission").select("commissionPercent").eq("opportunityId", directDeal), "Look again");
  assert.equal(direct.length, 1, "Setting the partner creates the record");
  await refused(
    sales.client.rpc("set_opportunity_partner", { p_opportunity: directDeal, p_partner: partnerId }),
    /already has a partner/i, "Setting it a second time",
  );
  pass("Given a partner once, which creates the record; it cannot be given another");

  // ═══════════════════════════════════════════════════════════════════════
  step("10", "A lead the partner referred carries them to the deal");
  // ═══════════════════════════════════════════════════════════════════════

  const referredLead = randomUUID();
  await ok(
    sales.client.from("lead").insert({
      id: referredLead, leadNumber: `L2CR-${run}`, firstName: "Ayesha", lastName: `Malik ${run}`,
      companyName: `L2C Referred Co ${run}`, email: `l2c-ayesha-${run.toLowerCase()}@example.com`,
      leadType: "SALES", status: "QUALIFIED", referredByPartnerId: partnerId,
      ownerUserId: sales.id, updatedAt: now(),
    }),
    "Create the referred lead",
  );
  ids.leads.push(referredLead);
  const conv = parse(await ok(
    sales.client.rpc("convert_lead", {
      p_lead_id: referredLead, p_actor_id: sales.id, p_account_id: null,
      p_create_opportunity: true, p_opportunity_name: `L2C Referred deal ${run}`,
      p_amount: 300000, p_expected_close: inDays(45),
      p_registered_at: null, p_expires_at: null, p_protection_days: null,
    }),
    "Convert the referred lead",
  ));
  ids.accounts.push(conv.accountId);
  ids.opportunities.push(conv.opportunityId);
  const referredDeal = await ok(
    admin.from("opportunity").select("sourcePartnerId").eq("id", conv.opportunityId).single(),
    "Read the converted deal",
  );
  assert.equal(referredDeal.sourcePartnerId, partnerId, "The deal is credited to the referring partner");
  const referredCommission = await ok(
    admin.from("partner_commission").select("baseAmount, partnerId").eq("opportunityId", conv.opportunityId).single(),
    "Read its commission",
  );
  assert.equal(money(referredCommission.baseAmount), 300000);
  pass("Converted with a deal: credited to the partner, with its commission record");

  // ═══════════════════════════════════════════════════════════════════════
  step("11", "A partner never sees another partner's commission");
  // ═══════════════════════════════════════════════════════════════════════

  const rivalAccount = randomUUID();
  await ok(
    admin.from("account").insert({
      id: rivalAccount, accountNumber: `L2CRA-${run}`, name: `L2C Rival partner ${run}`,
      accountType: "PARTNER", ownerUserId: sales.id, updatedAt: now(),
    }),
    "Create a rival partner company",
  );
  ids.accounts.push(rivalAccount);
  const rivalId = randomUUID();
  await ok(
    admin.from("partner").insert({
      id: rivalId, partnerNumber: `L2CRP-${run}`, displayName: `L2C Rival ${run}`, kind: "COMPANY",
      accountId: rivalAccount, partnerType: "REFERRAL", tier: "SILVER", status: "ACTIVE",
      defaultCommissionPercent: 15, updatedAt: now(),
    }),
    "Create the rival partner",
  );
  ids.partners.push(rivalId);
  const rivalCustomer = randomUUID();
  await ok(
    admin.from("account").insert({
      id: rivalCustomer, accountNumber: `L2CRC-${run}`, name: `L2C Rival customer ${run}`,
      accountType: "PROSPECT", ownerUserId: sales.id, sourcePartnerId: rivalId, updatedAt: now(),
    }),
    "Create the rival's customer",
  );
  ids.accounts.push(rivalCustomer);
  const rivalDeal = randomUUID();
  await ok(
    admin.from("opportunity").insert({
      id: rivalDeal, opportunityNumber: `L2CRO-${run}`, name: `L2C Rival deal ${run}`,
      accountId: rivalCustomer, ownerUserId: sales.id, amount: 90000, currencyCode: "PKR",
      expectedCloseDate: inDays(30), stage: "DISCOVERY", updatedAt: now(),
    }),
    "Raise the rival's deal",
  );
  ids.opportunities.push(rivalDeal);

  const visible = await ok(partner.client.from("partner_commission").select("opportunityId"), "List as the partner");
  assert.ok(!visible.some((r) => r.opportunityId === rivalDeal), "The rival's commission must be invisible");
  const rivalRow = await ok(admin.from("partner_commission").select("id").eq("opportunityId", rivalDeal).single(), "Find the rival's record");
  await refused(
    partner.client.rpc("partner_commission_request_percent", { p_id: rivalRow.id, p_percent: 50, p_reason: "Mine now" }),
    /not found/i, "Asking about the rival's commission",
  );
  const rivalDeals = await ok(partner.client.from("opportunity").select("id").eq("id", rivalDeal), "Look for the rival's deal");
  assert.equal(rivalDeals.length, 0, "Nor their deal");
  pass("The rival's deal and commission are invisible, and cannot be touched");

  console.log(`\n${"═".repeat(64)}\n  ${passed.length} checks passed   ·   run ${run}\n${"═".repeat(64)}`);
} catch (err) {
  console.error(`\n  FAIL  ${err.message}\n`);
  process.exitCode = 1;
} finally {
  for (const task of ids.teardown()) {
    const r = await task();
    if (r?.error) {
      console.error(`  Teardown: ${r.error.message}`);
      process.exitCode = 1;
    }
  }
  console.log("  Cleaned up.");
}
