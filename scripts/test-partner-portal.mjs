// Temporary Supabase identities against the real database. Never prints secrets.
// Covers the partner portal boundary: a partner login sees its own partner's
// deals, commission and payouts, and nothing belonging to anyone else.
// Usage: node scripts/test-partner-portal.mjs
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
  account: randomUUID(), otherAccount: randomUUID(),
  contact: randomUUID(),
  partner: randomUUID(), otherPartner: randomUUID(),
  myDeal: randomUUID(), otherDeal: randomUUID(),
  myCommission: randomUUID(), otherCommission: randomUUID(),
  login: null,
};
const cleanup = [];
const passed = [];
const pass = (name) => { passed.push(name); console.log(`PASS ${name}`); };
async function check(result, what) {
  const value = await result;
  if (value.error) throw new Error(`${what}: ${value.error.message}`);
  return value.data;
}

try {
  const owner = await check(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  );

  // Deliberately a CUSTOMER account: this partner also buys from us, which the
  // schema now allows and which used to rewrite the account's type.
  await check(db.from("account").insert([
    { id: ids.account, accountNumber: `QAPP-${run}`, name: `QA Reseller ${run}`, accountType: "CUSTOMER", ownerUserId: owner.id, updatedAt: now() },
    { id: ids.otherAccount, accountNumber: `QAPPX-${run}`, name: `QA Other Reseller ${run}`, accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now() },
  ]), "Create temporary accounts");
  cleanup.push(() => db.from("account").delete().in("id", [ids.account, ids.otherAccount]));

  await check(db.from("contact").insert({
    id: ids.contact, accountId: ids.account, firstName: "QA", lastName: `Reseller ${run}`,
    email: `qa-partner-${run}@example.com`, updatedAt: now(),
  }), "Create a temporary contact");
  cleanup.push(() => db.from("contact").delete().eq("id", ids.contact));

  await check(db.from("partner").insert([
    { id: ids.partner, partnerNumber: `QAP-${run}`, displayName: `QA Reseller ${run}`, kind: "COMPANY", accountId: ids.account, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE", updatedAt: now() },
    { id: ids.otherPartner, partnerNumber: `QAPX-${run}`, displayName: `QA Other ${run}`, kind: "COMPANY", accountId: ids.otherAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE", updatedAt: now() },
  ]), "Create temporary partners");
  cleanup.push(() => db.from("partner").delete().in("id", [ids.partner, ids.otherPartner]));
  pass("A customer account can carry a partner record, and stays a customer");

  const stillCustomer = await check(db.from("account").select("accountType").eq("id", ids.account).single(), "Re-read the account");
  assert.equal(stillCustomer.accountType, "CUSTOMER", "Adding a partner record must not rewrite the account type");

  await check(db.from("partner_contact").insert({
    id: randomUUID(), partnerId: ids.partner, contactId: ids.contact, role: "Owner", isPrimary: true, updatedAt: now(),
  }), "Link the contact to the partner");

  await check(db.from("opportunity").insert([
    { id: ids.myDeal, opportunityNumber: `QAPO1-${run}`, name: `QA partner deal ${run}`, accountId: ids.account, ownerUserId: owner.id, stage: "DISCOVERY", amount: 1000, currencyCode: "PKR", expectedCloseDate: "2026-12-01", sourcePartnerId: ids.partner, updatedAt: now() },
    { id: ids.otherDeal, opportunityNumber: `QAPO2-${run}`, name: `QA other deal ${run}`, accountId: ids.otherAccount, ownerUserId: owner.id, stage: "DISCOVERY", amount: 2000, currencyCode: "PKR", expectedCloseDate: "2026-12-01", sourcePartnerId: ids.otherPartner, updatedAt: now() },
  ]), "Create temporary deals");
  cleanup.push(() => db.from("opportunity").delete().in("id", [ids.myDeal, ids.otherDeal]));

  // Each deal got its commission record from the database when it was created.
  const records = await check(
    db.from("partner_commission").select("id, opportunityId").in("opportunityId", [ids.myDeal, ids.otherDeal]),
    "Find the commission records",
  );
  ids.myCommission = records.find((r) => r.opportunityId === ids.myDeal)?.id;
  ids.otherCommission = records.find((r) => r.opportunityId === ids.otherDeal)?.id;
  assert.ok(ids.myCommission && ids.otherCommission, "Both deals must have a commission record");
  pass("Each partner's deal has its commission record");

  const role = await check(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const password = randomBytes(24).toString("base64url");
  const email = `qa-partner-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids.login = auth.data.user.id;
  cleanup.push(() => db.auth.admin.deleteUser(ids.login));

  // A partner login that names the contact it belongs to: what the new
  // constraint allows and the partner page now creates.
  await check(db.from("app_user").insert({
    id: ids.login, fullName: `QA Reseller ${run}`, email, roleId: role.id,
    userType: "PARTNER", partnerId: ids.partner, contactId: ids.contact,
    status: "ACTIVE", updatedAt: now(),
  }), "Create the partner login");
  cleanup.push(() => db.from("app_user").delete().eq("id", ids.login));
  pass("A partner login can name the contact it belongs to");

  const asPartner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await asPartner.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`Partner sign-in: ${signIn.error.message}`);
  pass("A partner contact can sign in");

  const deals = await check(asPartner.from("opportunity").select("id, sourcePartnerId"), "Read deals as the partner");
  assert.deepEqual(deals.map((d) => d.id), [ids.myDeal], "A partner must see only the deals credited to them");
  pass("Sees their own deals, and no other partner's");

  const commissions = await check(asPartner.from("partner_commission").select("id, partnerId"), "Read commission as the partner");
  assert.deepEqual(commissions.map((c) => c.id), [ids.myCommission], "A partner must see only their own commission");
  pass("Sees their own commission, and nobody else's");

  const partners = await check(asPartner.from("partner").select("id"), "Read partners as the partner");
  assert.deepEqual(partners.map((p) => p.id), [ids.partner], "A partner must see only their own partner record");
  pass("Sees their own partner record only");

  for (const [table, what] of [
    ["expense", "expenses"],
    ["invoice", "invoices"],
    ["support_case", "support cases"],
    ["project", "projects"],
    ["product", "the product catalogue"],
    ["lead", "leads"],
  ]) {
    const { data } = await asPartner.from(table).select("id").limit(5);
    assert.equal((data ?? []).length, 0, `A partner must not read ${what}`);
  }
  pass("Cannot read expenses, invoices, cases, projects, products or leads");

  const people = await check(asPartner.from("app_user").select("id"), "Read people as the partner");
  assert.deepEqual(people.map((p) => p.id), [ids.login], "A partner must see only their own login");
  pass("Sees their own login only, never an employee");

  const write = await asPartner.from("partner_commission").update({ commissionPercent: 99 }).eq("id", ids.myCommission).select("id");
  assert.equal((write.data ?? []).length, 0, "A partner must not be able to edit their own commission");
  pass("Cannot edit their own commission");

  console.log(`\n${passed.length} checks passed.`);
} finally {
  for (const undo of cleanup.reverse()) {
    try { await undo(); } catch (err) { console.error("Cleanup failed:", err.message); }
  }
  console.log("Temporary data removed.");
}
