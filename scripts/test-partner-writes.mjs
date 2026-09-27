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
    { id: ids.myPartner, partnerNumber: `QAWP-${run}`, displayName: `QA Writer ${run}`, kind: "COMPANY", accountId: ids.myAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE", partnerManagerId: owner.id, updatedAt: now() },
    { id: ids.otherPartner, partnerNumber: `QAWPX-${run}`, displayName: `QA Rival ${run}`, kind: "COMPANY", accountId: ids.otherAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE", partnerManagerId: owner.id, updatedAt: now() },
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
  // Deleting a deal takes its commission record with it; the record's history
  // rows are separate and go first.
  cleanup.push(async () => {
    const { data } = await db.from("partner_commission").select("id").in("opportunityId", created.opportunities);
    const recordIds = (data ?? []).map((r) => r.id);
    return recordIds.length ? db.from("audit_history").delete().in("entityId", recordIds) : { error: null };
  });
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

  const credited = await check(
    db.from("opportunity").select("sourcePartnerId").eq("id", made.opportunityId).single(),
    "Re-read the deal's partner",
  );
  assert.equal(credited.sourcePartnerId, ids.myPartner, "The deal must be credited to the creating partner");
  const record = await check(
    db.from("partner_commission").select("partnerId, status").eq("opportunityId", made.opportunityId).single(),
    "Re-read the deal's commission record",
  );
  assert.equal(record.partnerId, ids.myPartner, "Its commission record must name the partner");
  assert.equal(record.status, "IN_PROGRESS", "And start in progress");
  pass("The deal is credited to the partner, with a commission record from the start");

  // --- 2. Seeing what they created -----------------------------------------

  const mine = await check(asPartner.from("account").select("id, name"), "List accounts as the partner");
  const visible = mine.map((a) => a.id).sort();
  // Exactly one: the customer they sourced. Their OWN company is deliberately
  // not here - Accounts in the portal means the customers they brought, and
  // their own company sitting among them carried buttons that could not work,
  // because the write path refuses a deal against an account nobody sourced.
  assert.deepEqual(
    visible,
    [made.accountId],
    "A partner must see exactly the accounts they sourced",
  );
  assert.ok(!visible.includes(ids.myAccount), "A partner must not see their own company here");
  assert.ok(!visible.includes(ids.rivalCustomer), "A partner must never see a rival's customer");
  assert.ok(!visible.includes(ids.otherAccount), "A partner must never see a rival's own company");
  pass("Sees the customers they sourced, and neither their own company nor a rival's");

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

  // --- 6. Rate requests ----------------------------------------------------
  //
  // The partner's half only: asking. Answering is done by a signed-in person who
  // decides commission, and is covered by scripts/test-lead-to-commission.mjs.

  const myRecord = await check(
    db.from("partner_commission").select("id, commissionPercent").eq("opportunityId", made.opportunityId).single(),
    "Find the partner's commission record",
  );
  await check(asPartner.rpc("partner_commission_request_percent", {
    p_id: myRecord.id,
    p_percent: 17.5,
    p_reason: "This one took three months of pre-sales work on our side.",
  }), "Ask for a different rate as the partner");
  pass("A partner can ask for a different rate on their own deal");

  // Asking must not pay anybody: the rate stays where it was until somebody
  // internal agrees it.
  const untouched = await check(
    db.from("partner_commission").select("commissionPercent, requestStatus").eq("id", myRecord.id).single(),
    "Re-read the record after the request",
  );
  assert.equal(Number(untouched.commissionPercent), Number(myRecord.commissionPercent), "A request must not change the rate by itself");
  assert.equal(untouched.requestStatus, "PENDING", "The request waits");
  pass("Asking does not change the rate");

  const second = await asPartner.rpc("partner_commission_request_percent", {
    p_id: myRecord.id, p_percent: 20, p_reason: "Trying again immediately.",
  });
  assert.ok(second.error, "A second open request on the same deal must be refused");
  assert.match(second.error.message, /already have a request/i, "The refusal should explain why");
  pass("Cannot stack a second open request on the same deal");

  // The rival's deal is not theirs to ask about. It takes the rival as its
  // partner from the rival's customer, and gets the rival's commission record.
  const rivalDeal = randomUUID();
  await check(db.from("opportunity").insert({
    id: rivalDeal, opportunityNumber: `QAWRD-${run}`, name: `QA Rival Deal ${run}`,
    accountId: ids.rivalCustomer, ownerUserId: owner.id, stage: "DISCOVERY",
    amount: 1000, currencyCode: "PKR", expectedCloseDate: "2026-12-01", updatedAt: now(),
  }), "Create the rival's deal");
  cleanup.push(() => db.from("opportunity").delete().eq("id", rivalDeal));
  const rivalRecord = await check(
    db.from("partner_commission").select("id, partnerId").eq("opportunityId", rivalDeal).single(),
    "Find the rival's commission record",
  );
  assert.equal(rivalRecord.partnerId, ids.otherPartner, "The rival's deal pays the rival");

  const notMine = await asPartner.rpc("partner_commission_request_percent", {
    p_id: rivalRecord.id, p_percent: 50, p_reason: "Not my deal at all.",
  });
  assert.ok(notMine.error, "Asking on another partner's deal must be refused");
  assert.match(notMine.error.message, /not found/i, "The refusal should not confirm the record exists");
  pass("Cannot ask for a rate on another partner's deal");

  const reject = await asPartner.rpc("partner_commission_mark", { p_id: myRecord.id, p_status: "REJECTED", p_reason: "No" });
  assert.ok(reject.error, "A partner must not reject commission");
  pass("Cannot reject their own commission");

  const seen = await check(asPartner.from("partner_commission").select("id, partnerId"), "Read commission as the partner");
  assert.ok(seen.length > 0, "The partner sees their own commission");
  assert.ok(seen.every((r) => r.partnerId === ids.myPartner), "A partner must see only their own commission");
  pass("Sees their own commission, and no other partner's");

  // --- 7. The conversation -------------------------------------------------

  const saidRaw = await check(asPartner.rpc("post_partner_message", {
    p_partner_id: ids.myPartner,
    p_body: "Can we talk about the timeline on this one?",
    p_kind: "MESSAGE", p_subject: null, p_to: null, p_email_id: null,
  }), "Post a message as the partner");
  const said = typeof saidRaw === "string" ? JSON.parse(saidRaw) : saidRaw;
  cleanup.push(() => db.from("partner_message").delete().eq("partnerId", ids.myPartner));

  // The side is decided in the database from the session. A partner must not
  // be able to post something that later reads as having come from us.
  assert.equal(said.authorSide, "PARTNER", "A partner's message must be recorded as theirs");
  pass("A partner can post to their own conversation");

  const forged = await asPartner.rpc("post_partner_message", {
    p_partner_id: ids.otherPartner,
    p_body: "Posting into somebody else's thread.",
    p_kind: "MESSAGE", p_subject: null, p_to: null, p_email_id: null,
  });
  assert.ok(forged.error, "Posting into another partnership must be refused");
  assert.match(forged.error.message, /your own partnership/i, "The refusal should say why");
  pass("Cannot post into another partner's conversation");

  // Our reply, written with the service role the way the application does.
  const ourReply = randomUUID();
  await check(db.from("partner_message").insert({
    id: ourReply, partnerId: ids.myPartner, kind: "MESSAGE",
    authorSide: "INTERNAL", authorUserId: owner.id, authorName: "QA Colleague",
    body: "Yes - let us set up a call this week.", updatedAt: now(),
  }), "Reply as a colleague");

  const otherThread = randomUUID();
  await check(db.from("partner_message").insert({
    id: otherThread, partnerId: ids.otherPartner, kind: "MESSAGE",
    authorSide: "INTERNAL", authorUserId: owner.id, authorName: "QA Colleague",
    body: "Private to the rival partner.", updatedAt: now(),
  }), "Write into the rival's thread");
  cleanup.push(() => db.from("partner_message").delete().eq("partnerId", ids.otherPartner));

  const threadSeen = await check(asPartner.from("partner_message").select("id, partnerId, body"), "Read the thread as the partner");
  assert.ok(threadSeen.every((m) => m.partnerId === ids.myPartner), "A partner must see only their own thread");
  assert.ok(!threadSeen.some((m) => m.id === otherThread), "A partner must never see a rival's thread");
  assert.equal(threadSeen.length, 2, "Their own message and our reply, and nothing else");
  pass("Sees their own conversation only, both sides of it");

  // Marking read only ever touches the OTHER side's messages: a partner
  // opening the thread has not read their own, and counting it would make our
  // unread badge wrong.
  const marked = await check(asPartner.rpc("mark_partner_messages_read", { p_partner_id: ids.myPartner }), "Mark the thread read");
  assert.equal(Number(marked), 1, "Only our message should be marked, not the partner's own");

  const theirOwn = await check(
    db.from("partner_message").select("readAt").eq("id", said.id ?? "").maybeSingle(),
    "Re-read the partner's own message",
  );
  if (theirOwn) assert.equal(theirOwn.readAt, null, "A partner's own message must not be marked as read by them");
  pass("Opening the thread marks only the other side's messages");

  const notTheirs = await asPartner.rpc("mark_partner_messages_read", { p_partner_id: ids.otherPartner });
  assert.ok(notTheirs.error, "Marking another partnership's thread must be refused");
  pass("Cannot mark another partner's conversation as read");

  const editAttempt = await asPartner.from("partner_message")
    .update({ body: "Rewritten after the fact." }).eq("id", ourReply).select("id");
  assert.equal((editAttempt.data ?? []).length, 0, "A partner must not edit what we said");
  pass("Cannot rewrite a message from the other side");

  // --- 8. A lapsed partnership stops creating ------------------------------

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
