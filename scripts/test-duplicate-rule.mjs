// The duplicate rule, as each kind of user meets it. Temporary identities
// against the real database; never prints secrets.
//
// The rule itself is a pair of triggers (20260928000001_duplicate_rule.sql),
// and the database check in that migration covers the matching. What is worth
// proving here, signed in, is what each kind of user is TOLD:
//
//   - staff are told who the person already is, with enough to open the record;
//   - a partner is told only that the person is known, and which of their own
//     details matched - unless the record is their own;
//   - a customer at the support portal cannot ask at all.
//
// Every number is random per run. The rule matches on the last nine digits, so
// a fixed number would find the previous run's leftovers and fail for real.
//
// Usage: node scripts/test-duplicate-rule.mjs
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
/** Nine random digits: a number's identity under the rule. */
const nine = () => String(Math.floor(Math.random() * 9e8) + 1e8);
const intl = (n) => `+92 ${n.slice(0, 3)} ${n.slice(3)}`;
const local = (n) => `0${n}`;

const passed = [];
const pass = (name) => { passed.push(name); console.log(`PASS ${name}`); };
const ids = { role: randomUUID(), partner: randomUUID(), partnerAccount: randomUUID() };
/** Logins in the order made. The first is staff, who owns the test's accounts. */
const logins = [];
const leads = [];
const contacts = [];
/** Customer accounts. The partner's own company is ids.partnerAccount. */
const accounts = [];

async function check(result, what) {
  const value = await result;
  if (value.error) throw new Error(`${what}: ${value.error.message}`);
  return value.data;
}

/** A write the rule must refuse. Returns the error, with its detail parsed. */
async function refused(promise, what) {
  const { error } = await promise;
  assert.ok(error, `${what} should have been refused, but it succeeded`);
  assert.equal(error.hint, "duplicate_person", `${what}: refused for the wrong reason - ${error.message}`);
  return { message: error.message, detail: JSON.parse(error.details) };
}

async function login(email, fields) {
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  const id = auth.data.user.id;
  logins.push(id);
  await check(db.from("app_user").insert({ id, email, status: "ACTIVE", updatedAt: now(), ...fields }), `Create ${email}`);
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`Sign in as ${email}: ${signIn.error.message}`);
  return { id, client };
}

function createLead(client, payload) {
  return client.rpc("create_record", {
    p_table: "lead",
    p_payload: { status: "NEW", ...payload },
    p_number_field: "leadNumber",
    p_sequence: "Lead",
  });
}

try {
  // --- Who is asking ---------------------------------------------------------

  await check(db.from("security_role").insert({
    id: ids.role, name: `Duplicate rule test ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now(),
  }), "Create a role for the staff user");
  const staff = await login(`dup-staff-${run}@example.com`, { fullName: `Dup Staff ${run}`, roleId: ids.role });

  // A partner, with a contact for their own login.
  const partnerPerson = randomUUID();
  await check(db.from("account").insert({
    id: ids.partnerAccount, accountNumber: `QADP-${run}`, name: `QA Dup Partner ${run}`,
    accountType: "PARTNER", ownerUserId: staff.id, updatedAt: now(),
  }), "Create the partner's company");
  await check(db.from("contact").insert({
    id: partnerPerson, accountId: ids.partnerAccount, firstName: "Partner", lastName: `Person ${run}`,
    email: `dup-partner-${run}@example.com`, updatedAt: now(),
  }), "Create the partner's person");
  contacts.push(partnerPerson);
  await check(db.from("partner").insert({
    id: ids.partner, partnerNumber: `QADPP-${run}`, displayName: `QA Dup Partner ${run}`, kind: "COMPANY",
    accountId: ids.partnerAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: staff.id, updatedAt: now(),
  }), "Create the partner");
  const partnerRole = await check(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const partner = await login(`dup-partner-${run}@example.com`, {
    fullName: `QA Dup Partner ${run}`, roleId: partnerRole.id, userType: "PARTNER",
    partnerId: ids.partner, contactId: partnerPerson,
  });

  // A customer of ours, whose contact is somebody the partner will run into.
  const customerAccount = randomUUID();
  const customerContact = randomUUID();
  const customerMobile = nine();
  await check(db.from("account").insert({
    id: customerAccount, accountNumber: `QADC-${run}`, name: `QA Dup Customer ${run}`,
    accountType: "CUSTOMER", ownerUserId: staff.id, updatedAt: now(),
  }), "Create our customer");
  accounts.push(customerAccount);
  await check(db.from("contact").insert({
    id: customerContact, accountId: customerAccount, firstName: "Kamran", lastName: `Customer ${run}`,
    email: `dup-kamran-${run}@example.com`, mobile: intl(customerMobile), updatedAt: now(),
  }), "Create our customer's contact");
  contacts.push(customerContact);

  const customerRole = await check(db.from("security_role").select("id").eq("name", "Customer").single(), "Find the Customer role");
  const customer = await login(`dup-customer-${run}@example.com`, {
    fullName: `QA Dup Customer ${run}`, roleId: customerRole.id, userType: "CUSTOMER",
    contactId: customerContact, portalScope: "ACCOUNT",
  });

  // --- 1. Staff are told who --------------------------------------------------

  const leadPhone = nine();
  const first = await check(createLead(staff.client, {
    firstName: "Amna", lastName: `Lead ${run}`, companyName: `Amna Foods ${run}`,
    email: `dup-amna-${run}@example.com`, phone: intl(leadPhone), ownerUserId: staff.id,
  }), "Create the first lead");
  leads.push(first.id);

  const sameEmail = await refused(createLead(staff.client, {
    firstName: "Somebody", lastName: "Else", email: `  DUP-AMNA-${run}@Example.com `, ownerUserId: staff.id,
  }), "A second lead with the same address in other case");
  assert.ok(sameEmail.message.includes(first.leadNumber), "The refusal must name the lead that exists");
  assert.equal(sameEmail.detail.id, first.id, "And carry its id, so the form can link to it");
  assert.equal(sameEmail.detail.hidden, false, "Nothing is hidden from staff");
  pass("A second lead with the same email address is refused, naming the one that exists");

  const crossField = await refused(createLead(staff.client, {
    firstName: "Somebody", lastName: "Else", whatsapp: local(leadPhone), ownerUserId: staff.id,
  }), "A lead with the first lead's phone as its WhatsApp number");
  assert.equal(crossField.detail.field, "whatsapp", "It should say the WhatsApp number is what matched");
  pass("The same number is caught across fields and formats: a phone as a WhatsApp, +92 as 0");

  const isContact = await refused(createLead(staff.client, {
    firstName: "Kamran", lastName: "Again", phone: local(customerMobile), ownerUserId: staff.id,
  }), "A lead for somebody who is already a customer's contact");
  assert.match(isContact.message, /already a contact/i, "It should say the person is a contact");
  assert.ok(isContact.message.includes(`QA Dup Customer ${run}`), "And at which customer");
  pass("A lead for an existing customer's contact is refused, saying whose contact they are");

  const secondContact = await refused(staff.client.rpc("create_contact", {
    p_payload: {
      accountId: customerAccount, firstName: "Kamran", lastName: "Twice",
      whatsapp: customerMobile, isPrimary: false,
    },
  }), "A second contact with the same number");
  assert.match(secondContact.message, /This contact already exists/i);
  pass("A second contact with the same number is refused");

  await check(staff.client.rpc("update_record", {
    p_table: "lead", p_id: first.id, p_payload: { companyName: `Amna Foods Ltd ${run}` },
    p_entity_type: "Lead", p_actor_id: staff.id,
  }), "Edit the lead's company");
  const editOnto = await refused(staff.client.rpc("update_record", {
    p_table: "lead", p_id: first.id, p_payload: { email: `dup-kamran-${run}@example.com` },
    p_entity_type: "Lead", p_actor_id: staff.id,
  }), "Editing the lead onto a contact's address");
  assert.equal(editOnto.detail.entity, "contact");
  pass("Editing a lead is checked only for what changed - and changing onto somebody else is refused");

  const batch = await check(staff.client.rpc("find_duplicate_people", {
    p_scope: "lead",
    p_rows: [
      { email: `nobody-${run}@example.com` },
      { email: `dup-amna-${run}@example.com` },
      { phone: intl(customerMobile) },
    ],
  }), "Check a list, as an import does");
  assert.deepEqual(batch.map((h) => h.row), [1, 2], "Only the rows that match come back, by position");
  assert.equal(batch[0].number, first.leadNumber);
  assert.equal(batch[1].entity, "contact");
  pass("A whole list is checked in one call, answering only for the people already on file");

  // Converting a lead whose person became a contact meanwhile uses that contact.
  const later = await check(createLead(staff.client, {
    firstName: "Bilal", lastName: `Later ${run}`, email: `dup-bilal-${run}@example.com`, ownerUserId: staff.id,
  }), "Create a lead");
  leads.push(later.id);
  const otherAccount = randomUUID();
  const bilalContact = randomUUID();
  await check(db.from("account").insert({
    id: otherAccount, accountNumber: `QADB-${run}`, name: `QA Bilal Traders ${run}`,
    accountType: "PROSPECT", ownerUserId: staff.id, updatedAt: now(),
  }), "Create another customer");
  accounts.push(otherAccount);
  await check(db.from("contact").insert({
    id: bilalContact, accountId: otherAccount, firstName: "Bilal", lastName: `Later ${run}`,
    email: `dup-bilal-${run}@example.com`, updatedAt: now(),
  }), "Add him as their contact, by hand, while the lead was being worked");
  contacts.push(bilalContact);

  const converted = await check(staff.client.rpc("convert_lead", {
    p_lead_id: later.id, p_actor_id: staff.id, p_account_id: null, p_create_opportunity: false,
    p_opportunity_name: null, p_amount: null, p_expected_close: null,
    p_registered_at: null, p_expires_at: null, p_protection_days: null,
  }), "Convert the lead");
  assert.equal(converted.reusedContact, true, "Conversion must use the contact he already is");
  assert.equal(converted.contactId, bilalContact);
  assert.equal(converted.accountId, otherAccount, "On that contact's account");
  const onAccount = await check(db.from("contact").select("id").eq("accountId", otherAccount), "Count the account's contacts");
  assert.equal(onAccount.length, 1, "No second contact may be made");
  pass("Converting a lead who is already a contact uses that contact and its account");

  // --- 2. A partner is told that, not who -------------------------------------

  const partnerAsks = await check(partner.client.rpc("find_duplicate_people", {
    p_scope: "lead", p_rows: [{ email: `dup-amna-${run}@example.com` }],
  }), "Check an address as the partner");
  assert.deepEqual(partnerAsks, [{ row: 0, field: "email", hidden: true }], "Only what matched, nothing about whom");
  pass("A partner checking somebody else's lead learns only that the address is known");

  const ownRaw = await check(partner.client.rpc("partner_create_customer", {
    p_account_name: `QA Dup Own Customer ${run}`, p_first_name: "Own", p_last_name: `Buyer ${run}`,
    p_email: `dup-own-${run}@example.com`, p_phone: intl(nine()), p_job_title: null, p_industry: null,
    p_city: null, p_website: null, p_deal_name: null, p_deal_amount: null, p_deal_close: null,
    p_deal_currency: "PKR", p_notes: null,
  }), "Create the partner's own customer");
  const own = typeof ownRaw === "string" ? JSON.parse(ownRaw) : ownRaw;
  accounts.push(own.accountId);
  contacts.push(own.contactId);

  const poached = await refused(partner.client.rpc("partner_add_contact", {
    p_account_id: own.accountId, p_first_name: "Kamran", p_last_name: "Poached",
    p_email: null, p_phone: local(customerMobile), p_job_title: null,
  }), "Adding our customer's contact to the partner's customer");
  assert.match(poached.message, /Someone with this phone number is already in our records/);
  assert.ok(!poached.message.includes("Kamran"), "Without saying who");
  assert.ok(!poached.message.includes("QA Dup Customer"), "Or whose");
  assert.deepEqual(poached.detail, { field: "phone", hidden: true });
  pass("A partner cannot add somebody already on file, and is told nothing about them");

  const ownAgain = await refused(partner.client.rpc("partner_create_customer", {
    p_account_name: `QA Dup Own Again ${run}`, p_first_name: "Own", p_last_name: "Again",
    p_email: `DUP-OWN-${run}@example.com`, p_phone: null, p_job_title: null, p_industry: null,
    p_city: null, p_website: null, p_deal_name: null, p_deal_amount: null, p_deal_close: null,
    p_deal_currency: "PKR", p_notes: null,
  }), "Registering the partner's own customer twice");
  assert.equal(ownAgain.detail.mine, true, "Their own record is theirs to see");
  assert.ok(ownAgain.message.includes(`Own Buyer ${run}`), "So the refusal names it");
  pass("A partner re-entering their own customer is told which record it is");

  const conflict = await check(partner.client.rpc("partner_find_conflict", {
    p_account_name: `Nothing Like It ${run}`, p_email: `dup-kamran-${run}@example.com`, p_phone: null,
  }), "Check a conflict on our customer's contact");
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.mine, false);
  assert.equal(conflict.matchedOn, "email");
  assert.equal(conflict.accountName, undefined, "The customer is not described to a partner");
  pass("The partner's conflict check says the person is known and what matched - nothing more");

  // --- 3. A customer cannot ask -----------------------------------------------

  const probe = await customer.client.rpc("find_duplicate_people", {
    p_scope: "lead", p_rows: [{ email: `dup-amna-${run}@example.com` }],
  });
  assert.ok(probe.error, "A support-portal customer must not be able to ask who we know");
  assert.match(probe.error.message, /not permitted/i);
  pass("A customer at the support portal cannot look people up");

  console.log(`\n${passed.length} checks passed.`);
} finally {
  // Order matters, because of what points at what. Leads point at contacts once
  // converted. The partner's and the customer's logins point at their contacts,
  // and cannot lose them. Customer accounts point at the partner who brought
  // them, and the partner at its company. Every account is owned by the staff
  // login, so that goes after them, and its role last of all.
  const [staffLogin, ...otherLogins] = logins;
  const dropLogin = (id) => [
    () => db.from("app_user").delete().eq("id", id),
    () => db.auth.admin.deleteUser(id),
  ];
  const steps = [
    () => (leads.length ? db.from("lead").delete().in("id", leads) : { error: null }),
    ...otherLogins.flatMap(dropLogin),
    () => (contacts.length ? db.from("contact").delete().in("id", contacts) : { error: null }),
    () => (accounts.length ? db.from("account").delete().in("id", accounts) : { error: null }),
    () => db.from("partner").delete().eq("id", ids.partner),
    () => db.from("account").delete().eq("id", ids.partnerAccount),
    ...(staffLogin ? dropLogin(staffLogin) : []),
    () => db.from("security_role").delete().eq("id", ids.role),
  ];
  const failures = [];
  for (const step of steps) {
    try {
      const r = await step();
      if (r?.error) failures.push(r.error.message);
    } catch (err) {
      failures.push(err.message);
    }
  }
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
