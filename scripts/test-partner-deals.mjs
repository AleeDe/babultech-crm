// A partner editing their accounts, people and deals, and closing a deal,
// signed in against the real database. Temporary identities; never prints
// secrets.
//
// The boundary is what matters: a partner edits and moves their own records,
// by our rules, and reaches nobody else's. Two partners, because isolation
// faults hide when there is only one.
//
// Usage: node scripts/test-partner-deals.mjs
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
  customer: randomUUID(), ours: randomUUID(), first: randomUUID(),
  deal: randomUUID(), deal2: randomUUID(), product: randomUUID(), quote: randomUUID(),
  contacts: [],
};

async function makePartner(label, owner) {
  const account = randomUUID();
  const partner = randomUUID();
  const person = randomUUID();
  await check(db.from("account").insert({
    id: account, accountNumber: `QAPD-${label}-${run}`, name: `QA Deals ${label} ${run}`,
    accountType: "PARTNER", ownerUserId: owner, updatedAt: now(),
  }), `Create ${label}'s company`);
  ids.partnerAccounts.push(account);
  await check(db.from("contact").insert({
    id: person, accountId: account, firstName: label, lastName: `Person ${run}`,
    email: `qa-pd-${label.toLowerCase()}-${run}@example.com`, updatedAt: now(),
  }), `Create ${label}'s person`);
  ids.people.push(person);
  await check(db.from("partner").insert({
    id: partner, partnerNumber: `QAPDP-${label}-${run}`, displayName: `QA Deals ${label} ${run}`,
    kind: "COMPANY", accountId: account, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: owner, defaultCommissionPercent: 10, updatedAt: now(),
  }), `Create partner ${label}`);
  ids.partners.push(partner);

  const role = await check(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const email = `qa-pd-${label.toLowerCase()}-${run}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(`Create identity: ${auth.error.message}`);
  ids.logins.push(auth.data.user.id);
  await check(db.from("app_user").insert({
    id: auth.data.user.id, fullName: `QA ${label} ${run}`, email, roleId: role.id, userType: "PARTNER", portalRole: "ADMIN",
    partnerId: partner, contactId: person, status: "ACTIVE", updatedAt: now(),
  }), `Create ${label}'s login`);
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`Sign in as ${label}: ${signIn.error.message}`);
  return { partner, client };
}

try {
  const owner = (await check(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  )).id;
  const me = await makePartner("Mine", owner);
  const rival = await makePartner("Rival", owner);

  // The partner's customer, its primary contact and two deals; and one of ours.
  await check(db.from("account").insert([
    { id: ids.customer, accountNumber: `QAPD-C-${run}`, name: `QA Deals Customer ${run}`, accountType: "PROSPECT", ownerUserId: owner, sourcePartnerId: me.partner, updatedAt: now() },
    { id: ids.ours, accountNumber: `QAPD-O-${run}`, name: `QA Deals Ours ${run}`, accountType: "CUSTOMER", ownerUserId: owner, sourcePartnerId: null, updatedAt: now() },
  ]), "Create the accounts");
  await check(db.from("contact").insert({
    id: ids.first, accountId: ids.customer, firstName: "Farah", lastName: `First ${run}`,
    email: `qa-pd-farah-${run}@example.com`, isPrimary: true, sourcePartnerId: me.partner, updatedAt: now(),
  }), "Create the primary contact");
  ids.contacts.push(ids.first);
  await check(db.from("opportunity").insert([
    { id: ids.deal, opportunityNumber: `QAPD-D1-${run}`, name: `QA Deals One ${run}`, accountId: ids.customer, ownerUserId: owner, stage: "DISCOVERY", amount: 0, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: me.partner, updatedAt: now() },
    { id: ids.deal2, opportunityNumber: `QAPD-D2-${run}`, name: `QA Deals Two ${run}`, accountId: ids.customer, ownerUserId: owner, stage: "DISCOVERY", amount: 1000, currencyCode: "PKR", expectedCloseDate: "2026-12-31", sourcePartnerId: me.partner, updatedAt: now() },
  ]), "Create the deals");
  await check(db.from("product").insert({
    id: ids.product, productCode: "auto", name: `QA Deals Item ${run}`, productType: "PRODUCT", addInTask: false, active: true, updatedAt: now(),
  }), "Create a product");

  // --- 1. Accounts and people ---------------------------------------------------

  await check(me.client.rpc("partner_update_account", {
    p_id: ids.customer,
    p_account: { name: `QA Deals Customer Ltd ${run}`, website: "https://example.com", billingAddress: { city: "Lahore" } },
  }), "Edit the account");
  const acct = await check(db.from("account").select("name, website, billingAddress").eq("id", ids.customer).single(), "Re-read the account");
  assert.equal(acct.name, `QA Deals Customer Ltd ${run}`);
  assert.equal(acct.billingAddress?.city, "Lahore");
  await refused(me.client.rpc("partner_update_account", { p_id: ids.ours, p_account: { name: "Taken" } }), "Editing our account", /not one of yours/i);
  await refused(rival.client.rpc("partner_update_account", { p_id: ids.customer, p_account: { name: "Taken" } }), "The rival editing it", /not one of yours/i);
  pass("The partner edits their account; ours and the rival's hands are refused");

  const added = await check(me.client.rpc("partner_save_contact", {
    p_id: null, p_account_id: ids.customer,
    p_contact: { firstName: "Saad", lastName: `Second ${run}`, email: `qa-pd-saad-${run}@example.com`, isPrimary: true },
  }), "Add a primary contact");
  ids.contacts.push(added.id);
  const firstNow = await check(db.from("contact").select("isPrimary").eq("id", ids.first).single(), "Re-read the old primary");
  assert.equal(firstNow.isPrimary, false, "Making a new primary demotes the old one");
  await check(me.client.rpc("partner_save_contact", {
    p_id: ids.first, p_account_id: ids.customer,
    p_contact: { firstName: "Farah", lastName: `First ${run}`, jobTitle: "CFO" },
  }), "Edit a contact");
  const farah = await check(db.from("contact").select("jobTitle, email").eq("id", ids.first).single(), "Re-read the contact");
  assert.equal(farah.jobTitle, "CFO");
  assert.equal(farah.email, `qa-pd-farah-${run}@example.com`, "What was not sent is left alone");
  await refused(rival.client.rpc("partner_save_contact", {
    p_id: ids.first, p_account_id: ids.customer, p_contact: { firstName: "Farah", lastName: "Taken" },
  }), "The rival editing the contact", /not one of yours/i);
  pass("People are added and edited; a new primary demotes the old; the rival is refused");

  // --- 2. The deal's details ------------------------------------------------------

  await check(me.client.rpc("partner_update_opportunity", {
    p_id: ids.deal,
    p_deal: { name: `QA Deals One (renamed) ${run}`, amount: "5000", probabilityPercent: "40", nextStep: "Send the proposal", primaryContactId: ids.first },
  }), "Edit the deal");
  const deal = await check(db.from("opportunity").select("name, amount, probabilityPercent, ownerUserId, primaryContactId").eq("id", ids.deal).single(), "Re-read the deal");
  assert.equal(Number(deal.amount), 5000);
  assert.equal(Number(deal.probabilityPercent), 40);
  assert.equal(deal.ownerUserId, owner, "The owner stays ours");
  await refused(me.client.rpc("partner_update_opportunity", {
    p_id: ids.deal, p_deal: { name: "x", primaryContactId: rival.partner },
  }), "A main contact from somewhere else", /does not work at this customer/i);
  await refused(rival.client.rpc("partner_update_opportunity", { p_id: ids.deal, p_deal: { name: "Taken" } }), "The rival editing the deal", /not one of yours/i);
  const direct = await me.client.from("opportunity").update({ amount: 999999 }).eq("id", ids.deal).select("id");
  assert.ok(direct.error || !direct.data?.length, "A deal is never written straight to the table");
  pass("The partner edits the deal's details, never its owner, and nobody else's deal");

  // --- 3. Stages and closing ------------------------------------------------------

  await check(me.client.rpc("partner_set_opportunity_stage", { p_id: ids.deal, p_stage: "NEGOTIATION" }), "Move to Negotiation");
  await refused(me.client.rpc("partner_set_opportunity_stage", { p_id: ids.deal, p_stage: "CLOSED_WON" }),
    "Winning with nothing on the deal", /at least one product or service/i);
  await check(db.from("opportunity_product").insert({
    opportunityId: ids.deal, productId: ids.product, quantity: 1, unitPrice: 5000, sortOrder: 1,
  }), "Add a line");
  await refused(me.client.rpc("partner_set_opportunity_stage", { p_id: ids.deal, p_stage: "CLOSED_WON" }),
    "Winning with no accepted quote", /accepted quotation/i);
  await check(db.from("quotation").insert({
    id: ids.quote, quoteNumber: `QAPD-Q-${run}`, opportunityId: ids.deal, accountId: ids.customer, versionNumber: 1,
    status: "ACCEPTED", quoteDate: "2026-09-27", expiryDate: "2026-10-27", currencyCode: "PKR", updatedAt: now(),
  }), "Record an accepted quote");
  const won = await check(me.client.rpc("partner_set_opportunity_stage", { p_id: ids.deal, p_stage: "CLOSED_WON" }), "Win the deal");
  assert.ok(won.projectNumber, "Winning starts the delivery project");
  const wonDeal = await check(db.from("opportunity").select("stage, actualCloseDate").eq("id", ids.deal).single(), "Re-read");
  assert.equal(wonDeal.stage, "CLOSED_WON");
  const record = await check(me.client.from("partner_commission").select("paymentDate").eq("opportunityId", ids.deal).single(), "Read the commission");
  assert.ok(record.paymentDate, "And the commission has its payment date");
  pass(`Won by the partner on our rules: project ${won.projectNumber} started, commission dated`);

  await refused(me.client.rpc("partner_set_opportunity_stage", { p_id: ids.deal2, p_stage: "CLOSED_LOST" }),
    "Losing with no reason", /loss reason/i);
  await check(me.client.rpc("partner_set_opportunity_stage", {
    p_id: ids.deal2, p_stage: "CLOSED_LOST", p_loss_reason: "Went with a cheaper supplier",
  }), "Lose the other deal");
  const lost = await check(me.client.from("partner_commission").select("status").eq("opportunityId", ids.deal2).single(), "Read its commission");
  assert.equal(lost.status, "REJECTED");
  await refused(rival.client.rpc("partner_set_opportunity_stage", { p_id: ids.deal2, p_stage: "DISCOVERY" }),
    "The rival reopening it", /not one of yours/i);
  pass("Lost with a reason, commission rejected; the rival cannot move it");

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
  const deals = [ids.deal, ids.deal2];
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
  await step("deals", () => db.from("opportunity").delete().in("id", deals));
  await step("product", () => db.from("product").delete().eq("id", ids.product));
  for (const id of ids.logins) {
    await step("login", () => db.from("app_user").delete().eq("id", id));
    await step("identity", () => db.auth.admin.deleteUser(id));
  }
  await step("contacts", () => db.from("contact").delete().in("id", [...ids.contacts, ...ids.people]));
  await step("accounts", () => db.from("account").delete().in("id", [ids.customer, ids.ours]));
  await step("partners", () => db.from("partner").delete().in("id", ids.partners));
  await step("partner companies", () => db.from("account").delete().in("id", ids.partnerAccounts));
  await step("audit", () => db.from("audit_history").delete().in("entityId", [...deals, ids.customer, ids.first]));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
