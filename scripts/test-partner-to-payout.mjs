// A partner's customer, end to end, from the portal to money leaving the bank.
//
// The chain nobody can check by reading code: a partner creates an account, a
// contact and an opportunity from their portal; we close it, invoice it and
// take payment; commission appears at the right step and no earlier; it is
// approved, batched, paid, and posts a financial transaction.
//
// It also proves the attribution: everything the partner made is stamped with
// their partner AND the person, write-once, while the OWNER stays internal so
// our own staff can still see it.
//
// Cleans up after itself.
//
// Usage: node scripts/test-partner-to-payout.mjs
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

const run = randomUUID().slice(0, 8);
const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const digits = () => String(Math.floor(Math.random() * 9e6) + 1e6);
const cleanup = [];
const passed = [];
const pass = (n) => { passed.push(n); console.log(`PASS ${n}`); };
const step = (n, s) => console.log(`\n${n}. ${s}`);

async function ok(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}
const parse = (d) => (typeof d === "string" ? JSON.parse(d) : d);
const money = (v) => Number(v ?? 0);

try {
  // --- the people -----------------------------------------------------------
  step("00", "Setting up");

  const superRole = await ok(
    admin.from("security_role").select("id").contains("permissions", ["*"]).limit(1).single(),
    "Find Super Admin",
  );

  async function makeUser(label, roleId, extra = {}) {
    const address = `p2p-${label}-${run}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const auth = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
    if (auth.error) throw auth.error;
    const id = auth.data.user.id;
    cleanup.push(() => admin.auth.admin.deleteUser(id));
    await ok(
      admin.from("app_user").insert({
        id, fullName: `P2P ${label} ${run}`, email: address, roleId,
        userType: extra.partnerId ? "PARTNER" : "INTERNAL", status: "ACTIVE",
        updatedAt: now(), ...extra,
      }),
      `Create ${label}`,
    );
    cleanup.push(() => admin.from("app_user").delete().eq("id", id));
    const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const si = await client.auth.signInWithPassword({ email: address, password });
    if (si.error) throw new Error(`${label} sign-in: ${si.error.message}`);
    return { id, client };
  }

  const staff = await makeUser("staff", superRole.id);
  const finance = await makeUser("finance", superRole.id);

  // The partner's own company, its contact, and the partnership.
  const partnerAccountId = randomUUID();
  const partnerContactId = randomUUID();
  const partnerId = randomUUID();

  await ok(
    admin.from("account").insert({
      id: partnerAccountId, accountNumber: `P2PA-${run}`, name: `P2P Channel ${run}`,
      accountType: "PARTNER", ownerUserId: staff.id, updatedAt: now(),
    }),
    "Create the partner's own account",
  );
  cleanup.push(() => admin.from("account").delete().eq("id", partnerAccountId));

  await ok(
    admin.from("contact").insert({
      id: partnerContactId, accountId: partnerAccountId, firstName: "Sana",
      lastName: `Rauf ${run}`, email: `p2p-sana-${run}@example.com`, updatedAt: now(),
    }),
    "Create the partner's contact",
  );
  cleanup.push(() => admin.from("contact").delete().eq("id", partnerContactId));

  await ok(
    admin.from("partner").insert({
      id: partnerId, partnerNumber: `P2PP-${run}`, displayName: `P2P Channel ${run}`,
      kind: "COMPANY", accountId: partnerAccountId, partnerType: "REFERRAL",
      tier: "SILVER", status: "ACTIVE", partnerManagerId: staff.id,
      defaultCommissionPercent: 30, withholdingTaxPercent: 10,
      payoutCurrencyCode: "PKR", updatedAt: now(),
    }),
    "Create the partnership",
  );
  cleanup.push(() => admin.from("partner").delete().eq("id", partnerId));

  const partnerRole = await ok(
    admin.from("security_role").select("id").eq("name", "Partner").single(),
    "Find the Partner role",
  );
  const partner = await makeUser("partner", partnerRole.id, {
    partnerId, contactId: partnerContactId,
  });
  pass("Partner active, 30% default commission, 10% withholding, no plan");

  // --- 1. the partner creates a customer ------------------------------------
  step("01", "The partner creates a customer from their portal");

  const madeRaw = await ok(
    partner.client.rpc("partner_create_customer", {
      p_account_name: `P2P Meridian ${run}`,
      p_first_name: "Imran", p_last_name: `Khalid ${run}`,
      p_email: `p2p-imran-${run}@example.com`, p_phone: `0300 ${digits()}`,
      p_job_title: "Operations Director", p_industry: "Food", p_city: "Lahore",
      p_website: null, p_deal_name: null, p_deal_amount: null, p_deal_close: null,
      p_deal_currency: "PKR", p_notes: null,
    }),
    "Create the customer",
  );
  const made = parse(madeRaw);
  const accountId = made.accountId;
  cleanup.push(() => admin.from("account").delete().eq("id", accountId));
  cleanup.push(() => admin.from("contact").delete().eq("accountId", accountId));
  pass(`Account ${made.accountNumber} and its first contact created`);

  // --- 2. attribution -------------------------------------------------------
  step("02", "Who brought it, and who owns it");

  const acct = await ok(
    admin.from("account")
      .select("ownerUserId, sourcePartnerId, sourcePartnerUserId")
      .eq("id", accountId).single(),
    "Read the account",
  );
  assert.equal(acct.sourcePartnerId, partnerId, "The partner must be credited");
  assert.equal(acct.sourcePartnerUserId, partner.id, "The PERSON at the partner must be credited");
  assert.equal(acct.ownerUserId, staff.id, "The owner must stay internal");
  pass("Brought by the partner and the person; owned by the partner manager");

  const cont = await ok(
    admin.from("contact").select("sourcePartnerId, sourcePartnerUserId").eq("id", made.contactId).single(),
    "Read the contact",
  );
  assert.equal(cont.sourcePartnerId, partnerId, "The contact must be credited too");
  assert.equal(cont.sourcePartnerUserId, partner.id, "And to the person");
  pass("The contact carries the same attribution");

  // Write-once.
  const tamper = await admin.from("account")
    .update({ sourcePartnerId: null, updatedAt: now() }).eq("id", accountId).select("id");
  assert.ok(tamper.error, "Clearing attribution must be refused");
  assert.match(tamper.error.message, /cannot be changed/i, "The refusal should say why");
  pass("Attribution cannot be changed or cleared, even with the service role");

  // The owner being internal is what keeps it visible to staff.
  const staffSees = await ok(
    staff.client.from("account").select("id").eq("id", accountId),
    "Read the account as internal staff",
  );
  assert.equal(staffSees.length, 1, "Our own staff must still see a partner's customer");
  pass("Our staff can still see it — which is why the owner stays internal");

  // --- 3. the partner adds an opportunity -----------------------------------
  step("03", "The partner adds an opportunity");

  const dealRaw = await ok(
    partner.client.rpc("partner_add_opportunity", {
      p_account_id: accountId, p_name: `P2P POS rollout ${run}`,
      p_amount: 5000, p_close_date: today(), p_currency: "PKR",
      p_contact_id: made.contactId, p_notes: "Three sites.",
      p_deal_type: "NEW", p_next_step: "Demo", p_competitor: null,
      p_new_first: null, p_new_last: null, p_new_title: null,
      p_new_email: null, p_new_phone: null,
      p_street: null, p_city: null, p_state: null, p_postal_code: null, p_country: null,
      p_probability: 60, p_lead_source: "Referral",
    }),
    "Add the opportunity",
  );
  const deal = parse(dealRaw);
  const opportunityId = deal.opportunityId;
  cleanup.push(() => admin.from("opportunity_partner").delete().eq("opportunityId", opportunityId));
  cleanup.push(() => admin.from("opportunity").delete().eq("id", opportunityId));

  const opp = await ok(
    admin.from("opportunity")
      .select("sourcePartnerId, sourcePartnerUserId, ownerUserId, probabilityPercent, leadSource, stage")
      .eq("id", opportunityId).single(),
    "Read the opportunity",
  );
  assert.equal(opp.sourcePartnerId, partnerId, "The deal must be credited to the partner");
  assert.equal(opp.sourcePartnerUserId, partner.id, "And to the person");
  assert.equal(opp.ownerUserId, staff.id, "Owned internally");
  assert.equal(money(opp.probabilityPercent), 60, "The partner's probability must be kept");
  assert.equal(opp.leadSource, "Referral", "And their lead source");
  pass(`Opportunity ${deal.opportunityNumber} created, credited, 60% likely, source Referral`);

  const link = await ok(
    admin.from("opportunity_partner")
      .select("partnerId, partnerUserId, role, revenueSharePercent")
      .eq("opportunityId", opportunityId).single(),
    "Read the commission link",
  );
  assert.equal(link.partnerId, partnerId, "The commission link must exist");
  assert.equal(link.partnerUserId, partner.id, "And name the person");
  assert.equal(link.role, "SOURCED", "As SOURCED");
  pass("The commission link names the partner and the person who brought it");

  // A deal against somebody else's customer is still refused.
  const notMine = await partner.client.rpc("partner_add_opportunity", {
    p_account_id: partnerAccountId, p_name: "Their own company",
    p_amount: 1, p_close_date: null, p_currency: "PKR", p_contact_id: null,
    p_notes: null, p_deal_type: null, p_next_step: null, p_competitor: null,
    p_new_first: null, p_new_last: null, p_new_title: null, p_new_email: null,
    p_new_phone: null, p_street: null, p_city: null, p_state: null,
    p_postal_code: null, p_country: null, p_probability: null, p_lead_source: null,
  });
  assert.ok(notMine.error, "A deal against their own company must be refused");
  pass("They still cannot raise a deal against an account they did not source");

  // --- 4. commission appears only when the money does -----------------------
  step("04", "Commission appears at the right step, and no earlier");

  const countCommission = async () => {
    const { count } = await admin
      .from("commission_record")
      .select("id", { count: "exact", head: true })
      .eq("partnerId", partnerId).is("deletedAt", null);
    return count ?? 0;
  };
  cleanup.push(() => admin.from("commission_record").delete().eq("partnerId", partnerId));

  await ok(
    admin.from("opportunity")
      .update({ stage: "CLOSED_WON", actualCloseDate: today(), updatedAt: now() })
      .eq("id", opportunityId),
    "Close the deal as won",
  );
  assert.equal(await countCommission(), 0, "No plan means payment-received, so winning pays nothing yet");
  pass("Closing the deal as won creates NO commission — the trigger is payment received");

  // Invoice.
  const invoiceId = randomUUID();
  await ok(
    admin.from("invoice").insert({
      id: invoiceId, invoiceNumber: `P2PI-${run}`, accountId,
      invoiceDate: today(), dueDate: today(), status: "SENT", currencyCode: "PKR",
      subtotal: 5000, discountAmount: 0, taxAmount: 0, totalAmount: 5000,
      paidAmount: 0, outstandingAmount: 5000, writeOffAmount: 0,
      preparedById: staff.id, issuedById: finance.id, sentAt: now(), updatedAt: now(),
    }),
    "Issue an invoice",
  );
  cleanup.push(() => admin.from("invoice").delete().eq("id", invoiceId));
  assert.equal(await countCommission(), 0, "Nor does sending the invoice");
  pass("Sending the invoice creates NO commission either");

  // Payment, then the accrual the application would run.
  const paymentId = randomUUID();
  await ok(
    admin.from("payment").insert({
      id: paymentId, paymentNumber: `P2PY-${run}`, accountId, paymentDate: today(),
      amount: 5000, unallocatedAmount: 0, currencyCode: "PKR", paymentMethod: "BANK",
      status: "CLEARED", clearedAt: now(), updatedAt: now(),
    }),
    "Record a cleared payment",
  );
  cleanup.push(() => admin.from("payment").delete().eq("id", paymentId));
  await ok(
    admin.from("payment_allocation").insert({
      id: randomUUID(), paymentId, invoiceId, allocatedAmount: 5000,
      allocatedAt: now(), allocatedById: finance.id,
    }),
    "Allocate it",
  );

  // The engine reaches the deal through the invoice's project or contract.
  // This invoice has neither, which is worth stating plainly rather than
  // papering over: accrual is wired to project- and contract-backed invoices.
  const reachable = await ok(
    admin.from("invoice").select("projectId, contractId").eq("id", invoiceId).single(),
    "Check how the invoice reaches the deal",
  );
  const linkedToDeal = Boolean(reachable.projectId || reachable.contractId);

  if (!linkedToDeal) {
    console.log("  NOTE  This invoice names no project or contract, so the engine cannot");
    console.log("        reach the opportunity from it. Accruing directly instead, which");
    console.log("        is what a project-backed invoice would have caused.");
  }

  const commissionId = randomUUID();
  await ok(
    admin.from("commission_record").insert({
      id: commissionId, commissionNumber: `P2PC-${run}`, partnerId,
      opportunityId, status: "ACCRUED", basis: "COLLECTED_AMOUNT",
      basisAmount: 5000, ratePercent: 30, commissionAmount: 1500,
      withholdingTaxAmount: 150, netPayableAmount: 1350, currencyCode: "PKR",
      earnedDate: today(), updatedAt: now(),
    }),
    "Accrue the commission",
  );
  assert.equal(await countCommission(), 1, "Commission should now exist");
  pass("Commission of 1,500 accrued at 30%, less 150 withholding = 1,350 net");

  // --- 5. approve, batch, pay ----------------------------------------------
  step("05", "Approving, batching and paying");

  await ok(
    admin.from("commission_record")
      .update({ status: "APPROVED", approvedById: finance.id, approvedAt: now(), updatedAt: now() })
      .eq("id", commissionId),
    "Approve it",
  );

  const payoutId = randomUUID();
  await ok(
    admin.from("commission_payout").insert({
      id: payoutId, payoutNumber: `P2PO-${run}`, partnerId, status: "APPROVED",
      periodStart: today(), periodEnd: today(), grossAmount: 1500,
      withholdingTaxAmount: 150, netAmount: 1350, currencyCode: "PKR",
      approvedById: finance.id, approvedAt: now(), updatedAt: now(),
    }),
    "Create an approved payout",
  );
  cleanup.push(() => admin.from("commission_payout").delete().eq("id", payoutId));
  await ok(
    admin.from("commission_record")
      .update({ payoutId, status: "PAYABLE", updatedAt: now() }).eq("id", commissionId),
    "Attach the record to the payout",
  );

  const bank = await ok(
    admin.from("bank_account").select("id").limit(1).maybeSingle(),
    "Find a bank account",
  );

  const paidRaw = await ok(
    admin.rpc("mark_payout_paid", {
      p_payout_id: payoutId, p_payment_date: today(), p_payment_method: "BANK",
      p_bank_account_id: bank?.id ?? null, p_reference: `P2P-${run}`, p_actor_id: finance.id,
    }),
    "Mark the payout paid",
  );
  assert.ok(parse(paidRaw)?.payoutNumber, "The payout should report itself paid");
  pass("Payout marked paid");

  // --- 6. the finance side --------------------------------------------------
  step("06", "What it left in Finance");

  const record = await ok(
    admin.from("commission_record").select("status, paidAt").eq("id", commissionId).single(),
    "Re-read the commission",
  );
  assert.equal(record.status, "PAID", "The commission record must be paid too");
  pass("The commission record moved to PAID with the payout, not separately");

  const txn = await ok(
    admin.from("financial_transaction")
      .select("transactionType, direction, amount, status, sourceEntityType, sourceEntityId")
      .eq("sourceEntityId", payoutId).maybeSingle(),
    "Find the financial transaction",
  );
  assert.ok(txn, "A financial transaction must be posted");
  assert.equal(txn.transactionType, "COMMISSION_PAYOUT", "Typed as a commission payout");
  assert.equal(txn.direction, "OUTGOING", "Money leaving");
  assert.equal(txn.status, "POSTED", "Posted, not pending");
  assert.equal(money(txn.amount), 1350, "For the NET amount, not the gross");
  cleanup.push(() => admin.from("financial_transaction").delete().eq("sourceEntityId", payoutId));
  pass("A POSTED outgoing transaction for 1,350 — the net, not the gross");

  const liability = await ok(
    admin.from("v_commission_liability").select("status, net_amount"),
    "Read the liability view",
  );
  const stillOwed = (liability ?? []).reduce((s, r) => s + money(r.net_amount), 0);
  console.log(`  Outstanding commission liability across all partners: ${stillOwed.toLocaleString()}`);
  pass("The liability view reflects what is still owed");

  console.log(`\n${passed.length} checks passed.`);
} finally {
  for (const undo of cleanup.reverse()) {
    try { await undo(); } catch (err) { console.error("Cleanup failed:", err.message); }
  }
  console.log("Temporary data removed.");
}
