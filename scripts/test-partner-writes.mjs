// Temporary Supabase identities against the real database. Never prints secrets.
//
// Covers what a partner may now WRITE. Until this week partners could only read,
// so the portal's whole defence was an absent INSERT policy. It is now four
// SECURITY DEFINER functions, and the thing worth proving is that they are as
// narrow as the absent policy was: a partner creates under their own name, sees
// what they created, and cannot reach across to another partner's customer.
//
// Two partners are set up deliberately. Most isolation bugs are invisible with
// one, because everything the test can see happens to be its own.
//
// Usage: node scripts/test-partner-writes.mjs
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
const ids = {
  myAccount: randomUUID(), otherAccount: randomUUID(), rivalCustomer: randomUUID(),
  myContact: randomUUID(), rivalContact: randomUUID(),
  myPartner: randomUUID(), otherPartner: randomUUID(),
  login: null,
};
const created = { accounts: [], contacts: [], opportunities: [] };
const cleanup = [];
const passed = [];
const pass = (name) => { passed.push(name); console.log(`PASS ${name}`); };

async function check(result, what) {
  const value = await result;
  if (value.error) throw new Error(`${what}: ${value.error.message}`);
  return value.data;
}

/** A call that must fail. Returns the error message for asserting on. */
async function mustFail(promise, what) {
  const { error } = await promise;
  assert.ok(error, `${what} should have been refused, but it succeeded`);
  return error.message;
}

try {
  const owner = await check(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  );

  // --- Two partners, so isolation can actually be observed -----------------

  await check(db.from("account").insert([
    { id: ids.myAccount, accountNumber: `QAW-${run}`, name: `QA Writer ${run}`, accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now() },
    { id: ids.otherAccount, accountNumber: `QAWX-${run}`, name: `QA Rival ${run}`, accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now() },
  ]), "Create partner accounts");
  cleanup.push(() => db.from("account").delete().in("id", [ids.myAccount, ids.otherAccount]));

  await check(db.from("contact").insert({
    id: ids.myContact, accountId: ids.myAccount, firstName: "QA", lastName: `Writer ${run}`,
    email: `qa-writer-${run}@example.com`, updatedAt: now(),
  }), "Create the partner's own contact");
  cleanup.push(() => db.from("contact").delete().eq("id", ids.myContact));

  await check(db.from("partner").insert([
    { id: ids.myPartner, partnerNumber: `QAWP-${run}`, displayName: `QA Writer ${run}`, kind: "COMPANY", accountId: ids.myAccount, partnerType: "RESELLER", status: "ACTIVE", partnerManagerId: owner.id, updatedAt: now() },
    { id: ids.otherPartner, partnerNumber: `QAWPX-${run}`, displayName: `QA Rival ${run}`, kind: "COMPANY", accountId: ids.otherAccount, partnerType: "RESELLER", status: "ACTIVE", partnerManagerId: owner.id, updatedAt: now() },
  ]), "Create partners");
  cleanup.push(() => db.from("partner").delete().in("id", [ids.myPartner, ids.otherPartner]));

  // A customer the RIVAL partner sourced. This is the record our partner must
  // never be able to write to, and must be told about only in outline.
  await check(db.from("account").insert({
    id: ids.rivalCustomer, accountNumber: `QAWC-${run}`, name: `QA Rival Customer ${run}`,
    accountType: "PROSPECT", ownerUserId: owner.id, sourcePartnerId: ids.otherPartner,
    updatedAt: now(),
  }), "Create the rival partner's customer");
  cleanup.push(() => db.from("account").delete().eq("id", ids.rivalCustomer));

  await check(db.from("contact").insert({
    id: ids.rivalContact, accountId: ids.rivalCustomer, firstName: "Secret", lastName: `Buyer ${run}`,
    email: `qa-secret-${run}@example.com`, phone: "+92 300 7654321", isPrimary: true, updatedAt: now(),
  }), "Create the rival customer's contact");
  cleanup.push(() => db.from("contact").delete().eq("id", ids.rivalContact));

  // --- Sign in as the partner ----------------------------------------------

  const role = await check(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const password = randomBytes(24).toString("base64url");
  const email = `qa-writer-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids.login = auth.data.user.id;
  cleanup.push(() => db.auth.admin.deleteUser(ids.login));

  await check(db.from("app_user").insert({
    id: ids.login, fullName: `QA Writer ${run}`, email, roleId: role.id,
    userType: "PARTNER", partnerId: ids.myPartner, contactId: ids.myContact,
    status: "ACTIVE", updatedAt: now(),
  }), "Create the partner login");
  cleanup.push(() => db.from("app_user").delete().eq("id", ids.login));

  const asPartner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await asPartner.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`Partner sign-in: ${signIn.error.message}`);

  // --- 1. Creating a customer ----------------------------------------------

  const madeRaw = await check(asPartner.rpc("partner_create_customer", {
    p_account_name: `QA Fresh Customer ${run}`,
    p_first_name: "Fresh", p_last_name: `Buyer ${run}`,
    p_email: `qa-fresh-${run}@example.com`, p_phone: "0300 1112222",
    p_job_title: "CTO", p_industry: "Software", p_city: "Lahore",
    p_website: null, p_deal_name: `QA Fresh Deal ${run}`,
    p_deal_amount: 500000, p_deal_close: "2026-12-31", p_deal_currency: "PKR",
    p_notes: "Created by the write-boundary test.",
  }), "Create a customer as the partner");
  const made = typeof madeRaw === "string" ? JSON.parse(madeRaw) : madeRaw;

  created.accounts.push(made.accountId);
  created.contacts.push(made.contactId);
  if (made.opportunityId) created.opportunities.push(made.opportunityId);
  cleanup.push(() => db.from("opportunity_partner").delete().in("opportunityId", created.opportunities));
  cleanup.push(() => db.from("opportunity").delete().in("id", created.opportunities));
  cleanup.push(() => db.from("contact").delete().in("id", created.contacts));
  cleanup.push(() => db.from("account").delete().in("id", created.accounts));

  assert.ok(made.accountId && made.contactId, "The account and contact must both be created");
  assert.ok(made.opportunityId, "A deal name was given, so the deal must be created too");
  assert.equal(made.contested, false, "A brand-new customer must not be contested");
  pass("A partner creates an account, a contact and a deal in one call");

  const stored = await check(
    db.from("account").select("sourcePartnerId, ownerUserId, registrationContested").eq("id", made.accountId).single(),
    "Re-read the created account",
  );
  assert.equal(stored.sourcePartnerId, ids.myPartner, "The account must be credited to the partner who created it");
  assert.equal(stored.ownerUserId, owner.id, "The account must be owned by the partner's manager, never the partner");
  pass("The account is credited to the partner and owned by their manager");

  const link = await check(
    db.from("opportunity_partner").select("partnerId, role").eq("opportunityId", made.opportunityId).single(),
    "Re-read the deal's partner link",
  );
  assert.equal(link.partnerId, ids.myPartner, "The deal must be linked to the creating partner");
  assert.equal(link.role, "SOURCED", "A partner-created deal must be SOURCED, or it pays no commission");
  pass("The deal is linked SOURCED, so commission will follow it");

  // --- 2. Seeing what they created -----------------------------------------

  const mine = await check(asPartner.from("account").select("id, name"), "List accounts as the partner");
  const visible = mine.map((a) => a.id).sort();
  assert.deepEqual(visible, [made.accountId].sort(), "A partner must see exactly the accounts they sourced");
  assert.ok(!visible.includes(ids.rivalCustomer), "A partner must never see a rival's customer");
  pass("Sees the customer they created, and not the rival's");

  const theirContacts = await check(asPartner.from("contact").select("id, email"), "List contacts as the partner");
  assert.ok(
    !theirContacts.some((c) => c.id === ids.rivalContact),
    "A partner must never read a rival customer's contact",
  );
  pass("Cannot read a rival customer's contact row");

  // --- 3. The conflict check tells, without telling too much ---------------

  const clashRaw = await check(asPartner.rpc("partner_find_conflict", {
    p_account_name: `QA Rival Customer ${run}`, p_email: null, p_phone: null,
  }), "Check a conflict on the rival's customer");
  const clash = typeof clashRaw === "string" ? JSON.parse(clashRaw) : clashRaw;

  assert.equal(clash.conflict, true, "A name that already exists must be reported as a conflict");
  assert.equal(clash.mine, false, "A rival's customer must not be reported as the partner's own");
  assert.equal(clash.broughtBy, `QA Rival ${run}`, "The partner holding the relationship must be named");
  const clashText = JSON.stringify(clash);
  assert.ok(!clashText.includes("qa-secret-"), "A conflict must never leak the existing contact's email");
  assert.ok(!clashText.includes("7654321"), "A conflict must never leak the existing contact's phone");
  pass("A conflict names the partner who holds it, and leaks no contact details");

  // The phone match ignores formatting, so a duplicate cannot be registered by
  // typing the same number a different way.
  const byPhoneRaw = await check(asPartner.rpc("partner_find_conflict", {
    p_account_name: `Totally Different Name ${run}`, p_email: null, p_phone: "03007654321",
  }), "Check a conflict by reformatted phone number");
  const byPhone = typeof byPhoneRaw === "string" ? JSON.parse(byPhoneRaw) : byPhoneRaw;
  assert.equal(byPhone.conflict, true, "A reformatted phone number must still match");
  pass("A reformatted phone number still finds the duplicate");

  // --- 4. Reaching across is refused ---------------------------------------

  const contactErr = await mustFail(
    asPartner.rpc("partner_add_contact", {
      p_account_id: ids.rivalCustomer, p_first_name: "Poached", p_last_name: "Person",
      p_email: null, p_phone: null, p_job_title: null,
    }),
    "Adding a contact to a rival's customer",
  );
  assert.match(contactErr, /not one of yours/i, "The refusal should say the customer is not theirs");

  await mustFail(
    asPartner.rpc("partner_add_opportunity", {
      p_account_id: ids.rivalCustomer, p_name: "Poached deal", p_amount: 1,
      p_close_date: null, p_currency: "PKR", p_contact_id: null, p_notes: null,
    }),
    "Adding a deal to a rival's customer",
  );
  pass("Cannot add a contact or a deal to another partner's customer");

  const stillOne = await check(
    db.from("contact").select("id").eq("accountId", ids.rivalCustomer),
    "Re-read the rival customer's contacts",
  );
  assert.equal(stillOne.length, 1, "The rival's customer must be untouched");
  pass("The rival's customer is provably unchanged");

  // --- 5. Writing directly, bypassing the functions ------------------------

  const direct = await asPartner.from("account").insert({
    id: randomUUID(), accountNumber: `QAWD-${run}`, name: `QA Direct ${run}`,
    accountType: "PROSPECT", ownerUserId: owner.id, updatedAt: now(),
  }).select("id");
  assert.ok(direct.error || (direct.data ?? []).length === 0, "A partner must not INSERT an account directly");

  const directContact = await asPartner.from("contact").insert({
    id: randomUUID(), accountId: made.accountId, firstName: "Direct", lastName: "Write", updatedAt: now(),
  }).select("id");
  assert.ok(
    directContact.error || (directContact.data ?? []).length === 0,
    "A partner must not INSERT a contact directly, even on their own customer",
  );
  pass("Cannot insert an account or contact directly, only through the functions");

  const edit = await asPartner.from("account")
    .update({ name: "Renamed by a partner" })
    .eq("id", made.accountId)
    .select("id");
  assert.equal((edit.data ?? []).length, 0, "A partner must not edit an account, even one they created");
  pass("Cannot edit an account after creating it");

  // --- 6. A lapsed partnership stops creating ------------------------------

  await check(
    db.from("partner").update({ status: "INACTIVE", updatedAt: now() }).eq("id", ids.myPartner),
    "Deactivate the partnership",
  );
  const inactiveErr = await mustFail(
    asPartner.rpc("partner_create_customer", {
      p_account_name: `QA Inactive ${run}`, p_first_name: "No", p_last_name: "Entry",
      p_email: null, p_phone: null, p_job_title: null, p_industry: null, p_city: null,
      p_website: null, p_deal_name: null, p_deal_amount: null, p_deal_close: null,
      p_deal_currency: "PKR", p_notes: null,
    }),
    "Creating a customer on an inactive partnership",
  );
  assert.match(inactiveErr, /active partnership/i, "The refusal should explain the partnership is not active");
  pass("An inactive partnership cannot create customers");

  console.log(`\n${passed.length} checks passed.`);
} finally {
  for (const undo of cleanup.reverse()) {
    try { await undo(); } catch (err) { console.error("Cleanup failed:", err.message); }
  }
  console.log("Temporary data removed.");
}
