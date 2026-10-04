// A partner working their own leads, signed in, against the real database.
// Temporary identities; never prints secrets.
//
// What is worth proving is the boundary, because every one of these writes is
// new for a partner: they create, edit, import, log and convert leads - their
// company's own, and nothing else. Two partners are set up, because most
// isolation faults cannot be seen with one.
//
// Usage: node scripts/test-partner-leads.mjs
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
const nine = () => String(Math.floor(Math.random() * 9e8) + 1e8);
const passed = [];
const pass = (name) => { passed.push(name); console.log(`PASS ${name}`); };
async function check(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = {
  partners: [], partnerAccounts: [], people: [], logins: [],
  ourLead: randomUUID(), ourAccount: randomUUID(), ourContact: randomUUID(),
  leads: [], accounts: [], contacts: [], deals: [], activities: [],
};

async function makePartner(label) {
  const account = randomUUID();
  const partner = randomUUID();
  const person = randomUUID();
  const owner = await check(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  );
  await check(db.from("account").insert({
    id: account, accountNumber: `QAPL-${label}-${run}`, name: `QA Leads ${label} ${run}`,
    accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now(),
  }), `Create ${label}'s company`);
  ids.partnerAccounts.push(account);
  await check(db.from("contact").insert({
    id: person, accountId: account, firstName: label, lastName: `Person ${run}`,
    email: `qa-pl-${label.toLowerCase()}-${run}@example.com`, updatedAt: now(),
  }), `Create ${label}'s person`);
  ids.people.push(person);
  await check(db.from("partner").insert({
    id: partner, partnerNumber: `QAPLP-${label}-${run}`, displayName: `QA Leads ${label} ${run}`,
    kind: "COMPANY", accountId: account, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: owner.id, defaultCommissionPercent: 10, updatedAt: now(),
  }), `Create partner ${label}`);
  ids.partners.push(partner);

  const role = await check(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const email = `qa-pl-${label.toLowerCase()}-${run}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(`Create identity: ${auth.error.message}`);
  const userId = auth.data.user.id;
  ids.logins.push(userId);
  await check(db.from("app_user").insert({
    id: userId, fullName: `QA ${label} ${run}`, email, roleId: role.id, userType: "PARTNER", portalRole: "ADMIN",
    partnerId: partner, contactId: person, status: "ACTIVE", updatedAt: now(),
  }), `Create ${label}'s login`);

  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`Sign in as ${label}: ${signIn.error.message}`);
  return { partner, userId, owner: owner.id, client };
}

try {
  const me = await makePartner("Mine");
  const rival = await makePartner("Rival");

  // One of our own leads, with a note our team wrote; and one of our customers.
  await check(db.from("lead").insert({
    id: ids.ourLead, leadNumber: `QAPL-OURS-${run}`, firstName: "Omar", lastName: `Ours ${run}`,
    email: `qa-pl-ours-${run}@example.com`, ownerUserId: me.owner, status: "NEW", updatedAt: now(),
  }), "Create our lead");
  await check(db.from("account").insert({
    id: ids.ourAccount, accountNumber: `QAPL-CUST-${run}`, name: `QA Leads Our Customer ${run}`,
    accountType: "CUSTOMER", ownerUserId: me.owner, updatedAt: now(),
  }), "Create our customer");
  await check(db.from("contact").insert({
    id: ids.ourContact, accountId: ids.ourAccount, firstName: "Cara", lastName: `Customer ${run}`,
    email: `qa-pl-cara-${run}@example.com`, updatedAt: now(),
  }), "Create our customer's contact");

  // --- 1. A partner's leads ---------------------------------------------------

  const phone = nine();
  const lead = await check(me.client.rpc("partner_save_lead", {
    p_id: null,
    p_lead: {
      firstName: "Lina", lastName: `Lead ${run}`, companyName: `Lina Traders ${run}`,
      email: `qa-pl-lina-${run}@example.com`, phone: `+92 ${phone.slice(0, 3)} ${phone.slice(3)}`,
    },
  }), "Create a lead as the partner");
  ids.leads.push(lead.id);
  assert.equal(lead.referredByPartnerId, me.partner, "The lead is credited to the partner");
  assert.equal(lead.ownerUserId, me.owner, "And owned inside by their manager");
  pass("A partner creates a lead - theirs, owned inside by their partner manager");

  const mine = await check(me.client.from("lead").select("id").is("deletedAt", null), "List leads as the partner");
  assert.deepEqual(mine.map((l) => l.id), [lead.id], "A partner sees exactly their own leads");
  const theirs = await check(rival.client.from("lead").select("id"), "List leads as the rival");
  assert.ok(!theirs.some((l) => l.id === lead.id || l.id === ids.ourLead), "The rival sees neither ours nor theirs");
  pass("Each partner sees only its own leads - never ours, never each other's");

  const direct = await me.client.from("lead").insert({
    id: randomUUID(), leadNumber: `QAPL-X-${run}`, firstName: "Direct", lastName: "Insert",
    ownerUserId: me.owner, status: "NEW", updatedAt: now(),
  }).select("id");
  assert.ok(direct.error || !direct.data?.length, "A partner may not insert a lead directly");
  const edited = await me.client.from("lead").update({ companyName: "Hacked" }).eq("id", lead.id).select("id");
  assert.ok(edited.error || !edited.data?.length, "Nor update one directly");
  pass("Leads are written only through the partner functions, never straight to the table");

  await check(me.client.rpc("partner_save_lead", {
    p_id: lead.id,
    p_lead: { firstName: "Lina", lastName: `Lead ${run}`, companyName: `Lina Traders Ltd ${run}`, status: "CONTACTED" },
  }), "Edit the lead");
  const reread = await check(db.from("lead").select("companyName, status, email").eq("id", lead.id).single(), "Re-read");
  assert.equal(reread.status, "CONTACTED");
  assert.equal(reread.email, `qa-pl-lina-${run}@example.com`, "A field the edit did not send is left as it was");
  pass("The partner edits their lead; fields not sent are left alone");

  const poach = await rival.client.rpc("partner_save_lead", {
    p_id: lead.id, p_lead: { firstName: "Taken", lastName: "Over" },
  });
  assert.ok(poach.error, "The rival cannot edit it");
  assert.match(poach.error.message, /not one of yours/i);
  const ours = await me.client.rpc("partner_save_lead", {
    p_id: ids.ourLead, p_lead: { firstName: "Omar", lastName: "Taken" },
  });
  assert.ok(ours.error, "Nor can a partner edit our lead");
  pass("Neither our leads nor another partner's can be edited");

  // --- 2. Importing --------------------------------------------------------------

  const imported = await check(me.client.rpc("partner_import_leads", {
    p_rows: [
      { firstName: "Nora", lastName: `New ${run}`, email: `qa-pl-nora-${run}@example.com` },
      { firstName: "Omar", lastName: "Copy", email: `QA-PL-OURS-${run}@example.com` },
      { firstName: "Cara", lastName: "Copy", email: `qa-pl-cara-${run}@example.com` },
      { firstName: "Lina", lastName: "Again", phone: `0${phone}` },
    ],
  }), "Import a list as the partner");
  const importedLeads = await check(db.from("lead").select("id").ilike("email", `qa-pl-nora-${run}@example.com`), "Find the import");
  ids.leads.push(...importedLeads.map((l) => l.id));
  assert.equal(imported.created, 1, "One new person imported");
  assert.equal(imported.skipped.length, 3, "Three left out");
  const reasons = JSON.stringify(imported.skipped);
  assert.ok(!reasons.includes("Omar Ours") && !reasons.includes("Cara Customer"), "Nobody else's person is named");
  assert.match(imported.skipped[2].reason, /Already your lead Lina Lead/, "Their own lead is named");
  pass("An import leaves out people already on file, naming only the partner's own");

  // --- 3. Logging what was done -----------------------------------------------

  const task = await check(me.client.rpc("partner_log_activity", {
    p_entity_type: "Lead", p_entity_id: lead.id,
    p_activity: { activityType: "TASK", subject: `Call back ${run}`, dueAt: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 16) },
  }), "Log a follow-up");
  ids.activities.push(task.id);
  // Our own team's note on the same lead.
  const ourNote = randomUUID();
  await check(db.from("activity").insert({
    id: ourNote, activityType: "LOG", subject: `Internal: partner is slow ${run}`, ownerUserId: me.owner,
    relatedEntityType: "Lead", relatedEntityId: lead.id, status: "COMPLETED", updatedAt: now(),
  }), "Write our own note on the lead");
  ids.activities.push(ourNote);

  const seen = await check(me.client.from("activity").select("id, subject").eq("relatedEntityId", lead.id), "Read the lead's activity");
  assert.deepEqual(seen.map((a) => a.id), [task.id], "The partner sees their own entries, never our notes");
  const rivalSees = await check(rival.client.from("activity").select("id").eq("relatedEntityId", lead.id), "Rival reads it");
  assert.equal(rivalSees.length, 0, "The rival sees none of it");
  pass("A follow-up is logged; the partner sees their company's entries and never our team's notes");

  const rivalLogs = await rival.client.rpc("partner_log_activity", {
    p_entity_type: "Lead", p_entity_id: lead.id, p_activity: { activityType: "LOG", subject: "Sneaky" },
  });
  assert.ok(rivalLogs.error, "The rival cannot log on it");
  await check(me.client.rpc("partner_close_activity", { p_id: task.id, p_status: "COMPLETED" }), "Close the follow-up");
  const closed = await check(db.from("activity").select("status").eq("id", task.id).single(), "Re-read the follow-up");
  assert.equal(closed.status, "COMPLETED");
  const rivalCloses = await rival.client.rpc("partner_close_activity", { p_id: task.id, p_status: "CANCELLED" });
  assert.ok(rivalCloses.error, "Nor close one of theirs");
  pass("Follow-ups are closed by the company that set them, and nobody else");

  // --- 4. Converting ------------------------------------------------------------

  const converted = await check(me.client.rpc("partner_convert_lead", {
    p_lead_id: lead.id, p_create_opportunity: true, p_opportunity_name: `QA Lina rollout ${run}`,
    p_amount: 80000, p_expected_close: null,
  }), "Convert the lead");
  ids.accounts.push(converted.accountId);
  ids.contacts.push(converted.contactId);
  ids.deals.push(converted.opportunityId);

  const account = await check(me.client.from("account").select("id, sourcePartnerId").eq("id", converted.accountId).single(), "The partner reads the new account");
  assert.equal(account.sourcePartnerId, me.partner);
  const deal = await check(me.client.from("opportunity").select("id, sourcePartnerId, amount").eq("id", converted.opportunityId).single(), "And the deal");
  assert.equal(deal.sourcePartnerId, me.partner);
  const commission = await check(me.client.from("partner_commission").select("partnerId, baseAmount").eq("opportunityId", deal.id).single(), "And its commission");
  assert.equal(Number(commission.baseAmount), 80000);
  const rivalSeesDeal = await check(rival.client.from("opportunity").select("id").eq("id", deal.id), "The rival looks for it");
  assert.equal(rivalSeesDeal.length, 0);
  pass("Converting makes an account, contact and deal credited to the partner, with a commission record");

  const again = await me.client.rpc("partner_convert_lead", {
    p_lead_id: lead.id, p_create_opportunity: false, p_opportunity_name: null, p_amount: null, p_expected_close: null,
  });
  assert.ok(again.error, "A lead is converted once");
  pass("A converted lead cannot be converted again");

  console.log(`\n${passed.length} checks passed.`);
} finally {
  // What points at what decides the order.
  const failures = [];
  const step = async (what, fn) => {
    try {
      const r = await fn();
      if (r?.error) failures.push(`${what}: ${r.error.message}`);
    } catch (err) {
      failures.push(`${what}: ${err.message}`);
    }
  };
  if (ids.deals.length) {
    await step("commission history", async () => {
      const { data } = await db.from("partner_commission").select("id").in("opportunityId", ids.deals);
      const recordIds = (data ?? []).map((r) => r.id);
      return recordIds.length ? db.from("audit_history").delete().in("entityId", recordIds) : { error: null };
    });
  }
  await step("activities", () => db.from("activity").delete().in("id", ids.activities));
  await step("leads", () => db.from("lead").delete().in("id", [...ids.leads, ids.ourLead]));
  await step("deals", () => (ids.deals.length ? db.from("opportunity").delete().in("id", ids.deals) : { error: null }));
  for (const id of ids.logins) {
    await step("login", () => db.from("app_user").delete().eq("id", id));
    await step("identity", () => db.auth.admin.deleteUser(id));
  }
  await step("contacts", () => db.from("contact").delete().in("id", [...ids.contacts, ids.ourContact, ...ids.people]));
  await step("accounts", () => db.from("account").delete().in("id", [...ids.accounts, ids.ourAccount]));
  await step("partners", () => db.from("partner").delete().in("id", ids.partners));
  await step("partner companies", () => db.from("account").delete().in("id", ids.partnerAccounts));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
