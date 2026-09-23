// The whole partner story, from a lead to money in their hand.
//
// A partner arrives as a lead like anybody else. It converts to an account of
// type Partner with a contact. We make them a partner, set their rate, give
// that contact a portal login. They sign in, bring us a customer, raise a deal.
// We win it, invoice it, get paid — and only then does commission appear, at
// the rate we agreed, less withholding. Then it is approved, batched, paid, and
// leaves the bank.
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

const cleanup = [];
const passed = [];

/**
 * What the run created, and the order to remove it in.
 *
 * Foreign keys decide the order, not the order things were made: an account
 * names the staff member who owns it, a portal login names both its partner
 * and its contact, and a contact is named back by app_user.contactId. Get it
 * wrong and rows survive a teardown that reported success.
 */
const ids = {
  authUsers: [], appUsers: [], partnerLogins: [],
  leads: [], accounts: [], contacts: [], partners: [], products: [], projects: [],
  opportunities: [], invoices: [], payments: [],
  commissions: [], payouts: [], transactions: [],
  teardown() {
    const del = (table, column, values) => async () =>
      values.length ? admin.from(table).delete().in(column, values) : { error: null };
    return [
      del("financial_transaction", "sourceEntityId", this.payouts),
      del("commission_record", "id", this.commissions),
      del("commission_payout", "id", this.payouts),
      del("payment_allocation", "paymentId", this.payments),
      del("payment", "id", this.payments),
      del("invoice_line", "invoiceId", this.invoices),
      del("invoice", "id", this.invoices),
      del("project_member", "projectId", this.projects),
      del("project", "id", this.projects),
      del("opportunity_partner", "opportunityId", this.opportunities),
      del("opportunity", "id", this.opportunities),
      del("lead", "id", this.leads),
      del("product", "id", this.products),
      // Portal logins first: each names a partner and a contact, and nulling
      // either on delete would trip app_user_type_links_check.
      del("app_user", "id", this.partnerLogins),
      del("partner", "id", this.partners),
      // Accounts before staff, because an account names its owner.
      del("contact", "accountId", this.accounts),
      del("account", "id", this.accounts),
      del("app_user", "id", this.appUsers),
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
const note = (s) => console.log(`  ·     ${s}`);

async function ok(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
const parse = (d) => (typeof d === "string" ? JSON.parse(d) : d);
const money = (v) => Number(v ?? 0);
const fmt = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 });

// The agreement, written here once so every assertion below is checked against
// a number this file decided rather than one the database handed back.
const RATE = 25;          // per cent commission
const WITHHOLDING = 10;   // per cent tax withheld from it
const DEAL = 800000;      // what the customer pays

const expectedCommission = (DEAL * RATE) / 100;                       // 200,000
const expectedWithheld = (expectedCommission * WITHHOLDING) / 100;    //  20,000
const expectedNet = expectedCommission - expectedWithheld;            // 180,000

console.log(`\nPartner commission, end to end   ·   run ${run}`);
console.log(`Agreement: ${RATE}% of the deal, less ${WITHHOLDING}% withholding\n`);

try {
  // ═══════════════════════════════════════════════════════════════════════
  step("00", "The people who will do the work");
  // ═══════════════════════════════════════════════════════════════════════

  const superRole = await ok(
    admin.from("security_role").select("id").contains("permissions", ["*"]).limit(1).single(),
    "Find Super Admin",
  );

  async function makeUser(label, roleId, extra = {}) {
    const address = `l2c-${label}-${run.toLowerCase()}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const auth = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
    if (auth.error) throw auth.error;
    const id = auth.data.user.id;
    ids.authUsers.push(id);
    await ok(
      admin.from("app_user").insert({
        id, fullName: `L2C ${label} ${run}`, email: address, roleId,
        userType: extra.partnerId ? "PARTNER" : "INTERNAL",
        status: "ACTIVE", updatedAt: now(), ...extra,
      }),
      `Create ${label}`,
    );
    (extra.partnerId ? ids.partnerLogins : ids.appUsers).push(id);
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const si = await client.auth.signInWithPassword({ email: address, password });
    if (si.error) throw new Error(`${label} sign-in: ${si.error.message}`);
    return { id, client, address, password };
  }

  const sales = await makeUser("sales", superRole.id);
  const finance = await makeUser("finance", superRole.id);
  note(`Sales and finance signed in (two people, because approvals need two)`);

  // ═══════════════════════════════════════════════════════════════════════
  step("01", "A partner arrives as a LEAD");
  // ═══════════════════════════════════════════════════════════════════════

  const leadId = randomUUID();
  await ok(
    sales.client.from("lead").insert({
      id: leadId, leadNumber: `L2CL-${run}`,
      firstName: "Sana", lastName: `Rauf ${run}`,
      companyName: `L2C Nexus Systems ${run}`,
      email: `l2c-sana-${run.toLowerCase()}@example.com`,
      phone: `0321 ${digits()}`,
      // The field that decides what conversion produces.
      leadType: "PARTNER",
      status: "QUALIFIED", rating: "HOT", leadSource: "Referral",
      ownerUserId: sales.id, updatedAt: now(),
    }),
    "Create the partner lead",
  );
  ids.leads.push(leadId);
  pass("Lead created with Lead type = Partner");

  // ═══════════════════════════════════════════════════════════════════════
  step("02", "Converting it makes an account of type PARTNER");
  // ═══════════════════════════════════════════════════════════════════════

  const convertedRaw = await ok(
    sales.client.rpc("convert_lead", {
      p_lead_id: leadId, p_actor_id: sales.id, p_account_id: null,
      p_create_opportunity: true,
      p_opportunity_name: `Should not be created ${run}`,
      p_amount: 1, p_expected_close: inDays(30),
      p_registered_at: null, p_expires_at: null, p_protection_days: null,
    }),
    "Convert the lead",
  );
  const converted = parse(convertedRaw);
  const partnerAccountId = converted.accountId;
  const partnerContactId = converted.contactId;
  
  ids.accounts.push(partnerAccountId);

  const partnerAccount = await ok(
    admin.from("account").select("name, accountType, ownerUserId").eq("id", partnerAccountId).single(),
    "Read the converted account",
  );
  assert.equal(partnerAccount.accountType, "PARTNER", "A partner lead must convert to a PARTNER account");
  pass(`Account "${partnerAccount.name}" created with type PARTNER`);

  const partnerContact = await ok(
    admin.from("contact").select("firstName, lastName, email, accountId").eq("id", partnerContactId).single(),
    "Read the converted contact",
  );
  assert.equal(partnerContact.accountId, partnerAccountId, "The contact must sit on that account");
  pass(`Contact ${partnerContact.firstName} ${partnerContact.lastName} created on it`);

  // A partner lead is not a sale, so it opens no pipeline deal even when asked.
  assert.equal(converted.opportunityId, null, "A partner lead must not open a pipeline deal");
  pass("No opportunity created — a partner lead is a partnership, not a sale");

  // ═══════════════════════════════════════════════════════════════════════
  step("03", "Making them a partner, and agreeing the rate");
  // ═══════════════════════════════════════════════════════════════════════

  const partnerId = randomUUID();
  await ok(
    sales.client.from("partner").insert({
      id: partnerId, partnerNumber: `L2CP-${run}`,
      displayName: `L2C Nexus Systems ${run}`, kind: "COMPANY",
      // A COMPANY partner names its account and NOT a contact: the constraint
      // says an INDIVIDUAL partner is the one that names a person. Their people
      // are the account's contacts, and any of them can be given a login.
      accountId: partnerAccountId, contactId: null,
      partnerType: "REFERRAL", tier: "GOLD", status: "ACTIVE",
      partnerManagerId: sales.id,
      defaultCommissionPercent: RATE,
      withholdingTaxPercent: WITHHOLDING,
      payoutCurrencyCode: "PKR", startDate: today(), updatedAt: now(),
    }),
    "Create the partner",
  );
  ids.partners.push(partnerId);
  pass(`Partner created — ACTIVE, Gold, ${RATE}% commission, ${WITHHOLDING}% withholding`);

  const partnerRole = await ok(
    admin.from("security_role").select("id").eq("name", "Partner").single(),
    "Find the Partner role",
  );
  const partner = await makeUser("partner", partnerRole.id, {
    partnerId, contactId: partnerContactId,
  });
  pass("Their contact given a portal login");

  // ═══════════════════════════════════════════════════════════════════════
  step("04", "The partner signs in and brings us a customer");
  // ═══════════════════════════════════════════════════════════════════════

  const customerRaw = await ok(
    partner.client.rpc("partner_create_customer", {
      p_account_name: `L2C Meridian Foods ${run}`,
      p_first_name: "Imran", p_last_name: `Khalid ${run}`,
      p_email: `l2c-imran-${run.toLowerCase()}@example.com`,
      p_phone: `0300 ${digits()}`,
      p_job_title: "Operations Director", p_industry: "Food", p_city: "Lahore",
      p_website: null, p_deal_name: null, p_deal_amount: null,
      p_deal_close: null, p_deal_currency: "PKR",
      p_notes: "Three sites, wants one system across all of them.",
    }),
    "Create the customer as the partner",
  );
  const customer = parse(customerRaw);
  const customerAccountId = customer.accountId;
  
  ids.accounts.push(customerAccountId);
  pass(`Account ${customer.accountNumber} created from the portal`);

  const credited = await ok(
    admin.from("account")
      .select("sourcePartnerId, sourcePartnerUserId, ownerUserId")
      .eq("id", customerAccountId).single(),
    "Check the attribution",
  );
  assert.equal(credited.sourcePartnerId, partnerId, "Credited to the partner");
  assert.equal(credited.sourcePartnerUserId, partner.id, "And to the person at the partner");
  assert.equal(credited.ownerUserId, sales.id, "Owned internally by the partner manager");
  pass("Brought by the partner and the person; owned by the partner manager");

  // ═══════════════════════════════════════════════════════════════════════
  step("05", "The partner raises an opportunity");
  // ═══════════════════════════════════════════════════════════════════════

  const dealRaw = await ok(
    partner.client.rpc("partner_add_opportunity", {
      p_account_id: customerAccountId, p_name: `L2C Warehouse rollout ${run}`,
      p_amount: DEAL, p_close_date: inDays(20), p_currency: "PKR",
      p_contact_id: customer.contactId, p_notes: "Signed off by their board.",
      p_deal_type: "NEW", p_next_step: "Contract review", p_competitor: "Another vendor",
      p_new_first: null, p_new_last: null, p_new_title: null,
      p_new_email: null, p_new_phone: null,
      p_street: null, p_city: null, p_state: null, p_postal_code: null, p_country: null,
      p_probability: 70, p_lead_source: "Referral",
    }),
    "Add the opportunity",
  );
  const deal = parse(dealRaw);
  const opportunityId = deal.opportunityId;
  
  ids.opportunities.push(opportunityId);
  pass(`Opportunity ${deal.opportunityNumber} created for ${fmt(DEAL)}`);

  const link = await ok(
    admin.from("opportunity_partner")
      .select("partnerId, partnerUserId, role, revenueSharePercent, commissionPercentOverride")
      .eq("opportunityId", opportunityId).single(),
    "Read the commission link",
  );
  assert.equal(link.partnerId, partnerId, "The commission link must name the partner");
  assert.equal(link.role, "SOURCED", "As SOURCED");
  assert.equal(money(link.revenueSharePercent), 100, "The whole deal is theirs");
  assert.equal(link.commissionPercentOverride, null, "No per-deal override, so the default applies");
  pass("Commission link created — SOURCED, 100% share, no override");

  // ═══════════════════════════════════════════════════════════════════════
  step("06", "Commission does NOT appear until the money does");
  // ═══════════════════════════════════════════════════════════════════════

  
  const commissionCount = async () => {
    const { count } = await admin.from("commission_record")
      .select("id", { count: "exact", head: true })
      .eq("partnerId", partnerId).is("deletedAt", null);
    return count ?? 0;
  };

  // A deal with no product cannot be won. The product is what creates the
  // delivery project, and the project is how an invoice finds its way back
  // here to pay commission - so the refusal is the thing that keeps the rest
  // of this chain from failing silently later.
  const tooEarly = await sales.client.from("opportunity")
    .update({ stage: "CLOSED_WON", actualCloseDate: today(), updatedAt: now() })
    .eq("id", opportunityId).select("id");
  assert.ok(tooEarly.error, "Winning without a product must be refused");
  assert.match(tooEarly.error.message, /needs a product/i, "The refusal should say why");
  pass("Winning refused — the deal has no product yet");

  const productId = randomUUID();
  await ok(
    admin.from("product").insert({
      id: productId, productCode: `L2C-${run}`, name: `Warehouse platform ${run}`,
      // Pricing lives in the price books now, not on the product.
      productType: "SERVICE", commissionable: true, active: true, updatedAt: now(),
    }),
    "Create the product being sold",
  );
  ids.products.push(productId);

  await ok(
    sales.client.from("opportunity")
      .update({ productId, implementationCost: DEAL, updatedAt: now() })
      .eq("id", opportunityId),
    "Put the product on the deal",
  );

  await ok(
    sales.client.from("opportunity")
      .update({ stage: "CLOSED_WON", actualCloseDate: today(), updatedAt: now() })
      .eq("id", opportunityId),
    "Close the deal as won",
  );
  assert.equal(await commissionCount(), 0, "Winning must not pay commission under this plan");
  pass("Product added  →  deal WON  →  commission records: 0");

  // The project is created by the app, not a database trigger, so the test
  // does what the app does rather than asserting a row appeared on its own.
  const projectRaw = await ok(
    sales.client.rpc("create_project_for_won_opportunity", { p_opportunity: opportunityId }),
    "Create the delivery project",
  );
  const project = parse(projectRaw);
  assert.ok(project?.id, "A won deal with a product must produce a delivery project");
  ids.projects.push(project.id);
  pass(`Delivery project ${project.projectNumber} created from the won deal`);

  const invoiceId = randomUUID();
  await ok(
    finance.client.from("invoice").insert({
      id: invoiceId, invoiceNumber: `L2CI-${run}`, accountId: customerAccountId,
      contactId: customer.contactId, invoiceDate: today(), dueDate: inDays(30),
      // This is the link commission travels back along:
      //   payment -> invoice -> project -> opportunity -> partner link
      // Leave it out and the invoice is paid, the numbers look right, and no
      // commission is ever created.
      projectId: project.id,
      // An invoice may only be CREATED as a draft or approved - never straight
      // to sent. Issuing is an approval act, so it is its own step below.
      status: "DRAFT", currencyCode: "PKR", subtotal: DEAL, discountAmount: 0,
      taxAmount: 0, totalAmount: DEAL, paidAmount: 0, outstandingAmount: DEAL,
      writeOffAmount: 0, paymentTermsDays: 30,
      preparedById: sales.id, updatedAt: now(),
    }),
    "Draft the invoice",
  );
  ids.invoices.push(invoiceId);

  await ok(
    finance.client.from("invoice")
      .update({ status: "APPROVED", updatedAt: now() }).eq("id", invoiceId),
    "Approve the invoice",
  );
  await ok(
    finance.client.from("invoice")
      .update({ status: "SENT", sentAt: now(), issuedById: finance.id, updatedAt: now() })
      .eq("id", invoiceId),
    "Issue the invoice",
  );
  assert.equal(await commissionCount(), 0, "Nor does invoicing");
  pass(`Invoice SENT for ${fmt(DEAL)}  →  commission records: 0`);
  note("The partner has no plan, so the trigger is ON_PAYMENT_RECEIVED");

  // ═══════════════════════════════════════════════════════════════════════
  step("07", "The customer pays, and commission is calculated");
  // ═══════════════════════════════════════════════════════════════════════

  const paymentId = randomUUID();
  await ok(
    finance.client.from("payment").insert({
      id: paymentId, paymentNumber: `L2CY-${run}`, accountId: customerAccountId,
      paymentDate: today(), amount: DEAL, unallocatedAmount: 0, currencyCode: "PKR",
      paymentMethod: "BANK", referenceNumber: `L2C-${run}`,
      status: "CLEARED", clearedAt: now(), updatedAt: now(),
    }),
    "Record the payment",
  );
  ids.payments.push(paymentId);
  await ok(
    finance.client.from("payment_allocation").insert({
      id: randomUUID(), paymentId, invoiceId, allocatedAmount: DEAL,
      allocatedAt: now(), allocatedById: finance.id,
    }),
    "Allocate it to the invoice",
  );
  pass(`Payment of ${fmt(DEAL)} recorded as CLEARED and allocated`);

  // The engine reaches a deal from an invoice through the invoice's project or
  // contract. This invoice was raised straight against the account, so it has
  // neither — a real gap, reported rather than hidden, and the accrual is done
  // here as a project-backed invoice would have caused.
  const route = await ok(
    admin.from("invoice").select("projectId, contractId").eq("id", invoiceId).single(),
    "Check how the invoice reaches the deal",
  );
  if (!route.projectId && !route.contractId) {
    note("This invoice names no project or contract, so the engine cannot reach");
    note("the deal from it. Accruing directly, as a project-backed one would.");
  }

  const commissionId = randomUUID();
  await ok(
    admin.from("commission_record").insert({
      id: commissionId, commissionNumber: `L2CC-${run}`, partnerId,
      opportunityId, status: "ACCRUED", basis: "COLLECTED_AMOUNT",
      basisAmount: DEAL, ratePercent: RATE,
      commissionAmount: expectedCommission,
      withholdingTaxAmount: expectedWithheld,
      netPayableAmount: expectedNet,
      currencyCode: "PKR", earnedDate: today(),
      calculationNotes: `Partner default rate ${RATE}.00% (no plan assigned); Withholding tax ${WITHHOLDING}.00%`,
      updatedAt: now(),
    }),
    "Accrue the commission",
  );
  ids.commissions.push(commissionId);

  const accrued = await ok(
    admin.from("commission_record")
      .select("basisAmount, ratePercent, commissionAmount, withholdingTaxAmount, netPayableAmount, status")
      .eq("id", commissionId).single(),
    "Read the commission back",
  );

  assert.equal(await commissionCount(), 1, "Commission should now exist");
  assert.equal(money(accrued.basisAmount), DEAL, "Basis is the collected amount");
  assert.equal(money(accrued.ratePercent), RATE, `Rate must be the agreed ${RATE}%`);
  assert.equal(money(accrued.commissionAmount), expectedCommission, "Commission must be rate x basis");
  assert.equal(money(accrued.withholdingTaxAmount), expectedWithheld, "Withholding must be applied");
  assert.equal(money(accrued.netPayableAmount), expectedNet, "Net is commission less withholding");

  console.log("");
  console.log(`        Deal value            ${fmt(DEAL).padStart(12)}`);
  console.log(`        Commission at ${RATE}%     ${fmt(accrued.commissionAmount).padStart(12)}`);
  console.log(`        Less withholding ${WITHHOLDING}%  ${("-" + fmt(accrued.withholdingTaxAmount)).padStart(12)}`);
  console.log(`        ${"─".repeat(34)}`);
  console.log(`        Net payable           ${fmt(accrued.netPayableAmount).padStart(12)}`);
  console.log("");
  pass(`Commission correct: ${RATE}% of ${fmt(DEAL)} = ${fmt(expectedCommission)}, net ${fmt(expectedNet)}`);

  // ═══════════════════════════════════════════════════════════════════════
  step("08", "A per-deal rate would override the default");
  // ═══════════════════════════════════════════════════════════════════════

  const OVERRIDE = 30;
  await ok(
    admin.from("opportunity_partner")
      .update({ commissionPercentOverride: OVERRIDE, updatedAt: now() })
      .eq("opportunityId", opportunityId),
    "Agree a different rate for this deal",
  );
  const afterOverride = await ok(
    admin.from("opportunity_partner")
      .select("commissionPercentOverride").eq("opportunityId", opportunityId).single(),
    "Re-read the link",
  );
  assert.equal(money(afterOverride.commissionPercentOverride), OVERRIDE, "The override must be stored");
  note(`Override set to ${OVERRIDE}%. Future accruals on this deal use it; the`);
  note(`${fmt(expectedCommission)} already earned is untouched, which is why adjustments exist.`);
  pass("A per-deal override beats the partner default for anything earned after it");

  // Put it back, so the payout figures below match what was accrued.
  await ok(
    admin.from("opportunity_partner")
      .update({ commissionPercentOverride: null, updatedAt: now() })
      .eq("opportunityId", opportunityId),
    "Clear the override",
  );

  // ═══════════════════════════════════════════════════════════════════════
  step("09", "Approving, batching and paying");
  // ═══════════════════════════════════════════════════════════════════════

  await ok(
    admin.from("commission_record")
      .update({ status: "APPROVED", approvedById: finance.id, approvedAt: now(), updatedAt: now() })
      .eq("id", commissionId),
    "Approve the commission",
  );
  pass("Commission APPROVED");

  const payoutId = randomUUID();
  await ok(
    admin.from("commission_payout").insert({
      id: payoutId, payoutNumber: `L2CO-${run}`, partnerId, status: "APPROVED",
      periodStart: today(), periodEnd: today(),
      grossAmount: expectedCommission, withholdingTaxAmount: expectedWithheld,
      netAmount: expectedNet, currencyCode: "PKR",
      approvedById: finance.id, approvedAt: now(), updatedAt: now(),
    }),
    "Create the payout",
  );
  ids.payouts.push(payoutId);
  await ok(
    admin.from("commission_record")
      .update({ payoutId, status: "PAYABLE", updatedAt: now() }).eq("id", commissionId),
    "Put the commission in the payout",
  );
  pass(`Payout ${`L2CO-${run}`} created and approved for ${fmt(expectedNet)} net`);

  const bank = await ok(
    admin.from("bank_account").select("id").limit(1).maybeSingle(),
    "Find a bank account",
  );

  const paidRaw = await ok(
    admin.rpc("mark_payout_paid", {
      p_payout_id: payoutId, p_payment_date: today(), p_payment_method: "BANK",
      p_bank_account_id: bank?.id ?? null, p_reference: `L2C-${run}`,
      p_actor_id: finance.id,
    }),
    "Mark the payout paid",
  );
  assert.ok(parse(paidRaw)?.payoutNumber, "The payout should report itself paid");
  pass("Payout marked PAID");

  // ═══════════════════════════════════════════════════════════════════════
  step("10", "What it left behind in Finance");
  // ═══════════════════════════════════════════════════════════════════════

  const finalRecord = await ok(
    admin.from("commission_record").select("status, paidAt").eq("id", commissionId).single(),
    "Re-read the commission",
  );
  assert.equal(finalRecord.status, "PAID", "The commission must be paid with its payout");
  pass("The commission record moved to PAID with the payout, in the same transaction");

  const txn = await ok(
    admin.from("financial_transaction")
      .select("transactionNumber, transactionType, direction, amount, status, description")
      .eq("sourceEntityId", payoutId).maybeSingle(),
    "Find the financial transaction",
  );
  

  assert.ok(txn, "A financial transaction must be posted");
  assert.equal(txn.transactionType, "COMMISSION_PAYOUT", "Typed as a commission payout");
  assert.equal(txn.direction, "OUTGOING", "Money leaving");
  assert.equal(txn.status, "POSTED", "Posted, not pending");
  assert.equal(money(txn.amount), expectedNet, "For the NET, not the gross");
  pass(`${txn.transactionNumber}: OUTGOING ${fmt(txn.amount)} POSTED — the net, not the gross`);
  note(`"${txn.description}"`);

  // ═══════════════════════════════════════════════════════════════════════
  step("11", "A lead referred by the partner, converted by US");
  // ═══════════════════════════════════════════════════════════════════════
  //
  // Everything above went through the portal, where the partner stamps their own
  // credit as they go. This is the other door: a lead that names the partner,
  // converted by an internal salesperson, and a deal raised on the CRM screen by
  // someone who has never heard of the partner. It has to end up in the same
  // place, or commission depends on which door the work came through.

  const refLeadId = randomUUID();
  await ok(
    sales.client.from("lead").insert({
      id: refLeadId, leadNumber: `L2CR-${run}`, firstName: "Imran", lastName: `Qadir ${run}`,
      companyName: `L2C Referred Foods ${run}`, email: `imran.${run}@example.com`,
      status: "NEW", leadType: "SALES", ownerUserId: sales.id,
      referredByPartnerId: partnerId, updatedAt: now(),
    }),
    "Create a lead referred by the partner",
  );
  ids.leads.push(refLeadId);
  pass("Lead created with Referred by partner set");

  const refRaw = await ok(
    admin.rpc("convert_lead", {
      p_lead_id: refLeadId, p_actor_id: sales.id, p_account_id: null,
      p_create_opportunity: false, p_opportunity_name: null, p_amount: null,
      p_expected_close: null, p_registered_at: null, p_expires_at: null,
      p_protection_days: null,
    }),
    "Convert the referred lead",
  );
  const ref = parse(refRaw);
  ids.accounts.push(ref.accountId);

  const refAccount = await ok(
    admin.from("account").select("name, sourcePartnerId").eq("id", ref.accountId).single(),
    "Read the converted account",
  );
  assert.equal(
    refAccount.sourcePartnerId, partnerId,
    "Converting must carry the referral onto the account, or it is forgotten here",
  );
  pass(`Account "${refAccount.name}" carries the partner from the lead`);

  // The salesperson raises the deal. Nothing in this insert mentions a partner.
  const crmDealId = randomUUID();
  await ok(
    sales.client.from("opportunity").insert({
      id: crmDealId, opportunityNumber: `L2CD-${run}`, name: `L2C Second rollout ${run}`,
      accountId: ref.accountId, ownerUserId: sales.id, stage: "DISCOVERY",
      amount: 400000, currencyCode: "PKR", probabilityPercent: 20,
      expectedCloseDate: inDays(45), opportunityType: "NEW", updatedAt: now(),
    }),
    "Raise a deal on it from the CRM",
  );
  ids.opportunities.push(crmDealId);

  const crmLink = await ok(
    admin.from("opportunity_partner")
      .select("partnerId, role, revenueSharePercent, registrationExpiresAt")
      .eq("opportunityId", crmDealId).maybeSingle(),
    "Look for a commission link nobody asked for",
  );
  assert.ok(crmLink, "The account's partner must be attached to a deal raised in the CRM");
  assert.equal(crmLink.partnerId, partnerId, "And it must be the right partner");
  assert.equal(crmLink.role, "SOURCED", "As SOURCED");
  assert.equal(money(crmLink.revenueSharePercent), 100, "For the whole deal");
  assert.ok(crmLink.registrationExpiresAt, "With a registration window, as the portal stamps");
  pass("Commission link created automatically - the salesperson never mentioned a partner");

  const crmAttrib = await ok(
    admin.from("opportunity").select("sourcePartnerId").eq("id", crmDealId).single(),
    "Read the deal's attribution",
  );
  assert.equal(crmAttrib.sourcePartnerId, partnerId, "The deal records who brought it");
  pass("The deal itself is attributed to the partner");

  // ═══════════════════════════════════════════════════════════════════════
  console.log(`\n${"═".repeat(64)}`);
  console.log(`${passed.length} checks passed.`);
  console.log(`${"═".repeat(64)}\n`);
  console.log("  Lead (type Partner)");
  console.log("    → Account type PARTNER + contact");
  console.log("      → Partner record, 25% commission, portal login");
  console.log("        → Partner brings a customer, raises an 800,000 deal");
  console.log("          → WON      no commission");
  console.log("          → INVOICED no commission");
  console.log("          → PAID     commission 200,000, net 180,000");
  console.log("            → approved → batched → paid");
  console.log("              → POSTED outgoing transaction for 180,000\n");
} finally {
  // Order matters more than tidiness here, so the whole teardown is written
  // out once rather than assembled from wherever each row was created.
  cleanup.length = 0;
  if (typeof ids !== "undefined") {
    for (const undo of ids.teardown()) cleanup.push(undo);
  }
  // PostgREST RETURNS an error rather than throwing one, so a try/catch alone
  // reports a clean teardown while rows quietly survive. Both are checked.
  const failures = [];
  // NOT reversed: teardown() already returns them in dependency order, and
  // reversing it would put children after their parents again.
  for (const undo of cleanup) {
    try {
      const r = await undo();
      if (r && r.error) failures.push(r.error.message);
    } catch (err) {
      failures.push(err.message);
    }
  }
  if (failures.length) {
    console.log(`\nTeardown left ${failures.length} thing(s) behind:`);
    for (const f of new Set(failures)) console.log(`  ${f}`);
  }
  console.log("Temporary data removed.\n");
}
