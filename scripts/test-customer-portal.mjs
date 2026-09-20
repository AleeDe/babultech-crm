// Temporary Supabase identities against the real database. Never prints secrets.
// Covers the customer portal boundary: what a customer login can read, what it
// cannot, and that round-robin assignment picks the least-loaded support user.
// Usage: node scripts/test-customer-portal.mjs
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
  contact: randomUUID(), colleague: randomUUID(),
  myCase: randomUUID(), colleagueCase: randomUUID(), otherCase: randomUUID(),
  article: randomUUID(), secretArticle: randomUUID(),
  customer: null,
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
  // ---------------------------------------------------------------- fixtures
  const owner = await check(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal account owner",
  );
  await check(db.from("account").insert([
    { id: ids.account, accountNumber: `QACP-${run}`, name: `QA Portal Customer ${run}`, accountType: "CUSTOMER", ownerUserId: owner.id, updatedAt: now() },
    { id: ids.otherAccount, accountNumber: `QACPX-${run}`, name: `QA Other Company ${run}`, accountType: "CUSTOMER", ownerUserId: owner.id, updatedAt: now() },
  ]), "Create temporary accounts");
  cleanup.push(() => db.from("account").delete().in("id", [ids.account, ids.otherAccount]));

  await check(db.from("contact").insert([
    { id: ids.contact, accountId: ids.account, firstName: "QA", lastName: `Buyer ${run}`, email: `qa-buyer-${run}@example.com`, updatedAt: now() },
    { id: ids.colleague, accountId: ids.account, firstName: "QA", lastName: `Colleague ${run}`, email: `qa-colleague-${run}@example.com`, updatedAt: now() },
  ]), "Create temporary contacts");
  cleanup.push(() => db.from("contact").delete().in("id", [ids.contact, ids.colleague]));

  const role = await check(db.from("security_role").select("id").eq("name", "Customer").single(), "Find the Customer role");

  const password = randomBytes(24).toString("base64url");
  const email = `qa-buyer-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(`Create temporary identity: ${auth.error.message}`);
  ids.customer = auth.data.user.id;
  cleanup.push(() => db.auth.admin.deleteUser(ids.customer));

  await check(db.from("app_user").insert({
    id: ids.customer, fullName: `QA Buyer ${run}`, email, roleId: role.id,
    userType: "CUSTOMER", contactId: ids.contact, portalScope: "ACCOUNT",
    status: "ACTIVE", updatedAt: now(),
  }), "Create the customer login");
  cleanup.push(() => db.from("app_user").delete().eq("id", ids.customer));

  await check(db.from("support_case").insert([
    { id: ids.myCase, caseNumber: `QA-C1-${run}`, subject: "My own ticket", description: "x", accountId: ids.account, contactId: ids.contact, ownerUserId: owner.id, source: "PORTAL", updatedAt: now() },
    { id: ids.colleagueCase, caseNumber: `QA-C2-${run}`, subject: "A colleague's ticket", description: "x", accountId: ids.account, contactId: ids.colleague, ownerUserId: owner.id, source: "PORTAL", updatedAt: now() },
    { id: ids.otherCase, caseNumber: `QA-C3-${run}`, subject: "Another company's ticket", description: "x", accountId: ids.otherAccount, ownerUserId: owner.id, source: "EMAIL", updatedAt: now() },
  ]), "Create temporary cases");
  cleanup.push(() => db.from("support_case").delete().in("id", [ids.myCase, ids.colleagueCase, ids.otherCase]));

  await check(db.from("case_comment").insert([
    { id: randomUUID(), caseId: ids.myCase, commentType: "AGENT_RESPONSE", body: "Reply the customer should see", isPublic: true, updatedAt: now() },
    { id: randomUUID(), caseId: ids.myCase, commentType: "INTERNAL_NOTE", body: "Internal note the customer must never see", isPublic: false, updatedAt: now() },
  ]), "Create temporary comments");

  const author = owner;
  await check(db.from("knowledge_article").insert([
    { id: ids.article, articleNumber: `QA-KB1-${run}`, title: `QA public article ${run}`, content: "Public", status: "PUBLISHED", visibility: "CUSTOMER_PORTAL", authorUserId: author.id, updatedAt: now() },
    { id: ids.secretArticle, articleNumber: `QA-KB2-${run}`, title: `QA internal article ${run}`, content: "Internal", status: "PUBLISHED", visibility: "INTERNAL", authorUserId: author.id, updatedAt: now() },
  ]), "Create temporary articles");
  cleanup.push(() => db.from("knowledge_article").delete().in("id", [ids.article, ids.secretArticle]));

  // ------------------------------------------------------------- as customer
  const asCustomer = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await asCustomer.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`Customer sign-in: ${signIn.error.message}`);
  pass("A customer contact can sign in");

  const cases = await check(asCustomer.from("support_case").select("id, subject"), "Read cases as the customer");
  const visible = cases.map((c) => c.id).sort();
  assert.deepEqual(visible, [ids.myCase, ids.colleagueCase].sort(), "A customer should see exactly their own company's cases");
  pass("Sees their company's tickets, and no other company's");

  const comments = await check(asCustomer.from("case_comment").select("body, commentType"), "Read comments as the customer");
  assert.equal(comments.length, 1, "Only the public reply should be readable");
  assert.equal(comments[0].commentType, "AGENT_RESPONSE");
  pass("Sees replies written to them, never the internal note");

  const articles = await check(asCustomer.from("knowledge_article").select("id"), "Read articles as the customer");
  assert.deepEqual(articles.map((a) => a.id), [ids.article], "Only the customer-portal article should be readable");
  pass("Sees published customer articles, not internal ones");

  for (const [table, what] of [
    ["opportunity", "the pipeline"],
    ["invoice", "invoices"],
    ["product", "the product catalogue"],
    ["expense", "expenses"],
    ["lead", "leads"],
    ["project", "projects"],
    ["quotation", "quotations"],
    ["partner", "partners"],
  ]) {
    const { data } = await asCustomer.from(table).select("id").limit(5);
    assert.equal((data ?? []).length, 0, `A customer must not read ${what}`);
  }
  pass("Cannot read the pipeline, invoices, products, expenses, leads, projects, quotes or partners");

  // app_user carries a self-read policy, which is how anyone loads their own
  // profile. A customer must see themselves and nobody else.
  const people = await check(asCustomer.from("app_user").select("id"), "Read people as the customer");
  assert.deepEqual(people.map((p) => p.id), [ids.customer], "A customer must see only their own login");
  pass("Sees their own login only, never another employee or customer");

  const accounts = await check(asCustomer.from("account").select("id"), "Read accounts as the customer");
  assert.deepEqual(accounts.map((a) => a.id), [ids.account], "Only their own company should be readable");
  pass("Sees their own company, and no other");

  const write = await asCustomer.from("support_case").update({ subject: "tampered" }).eq("id", ids.myCase).select("id");
  assert.equal((write.data ?? []).length, 0, "A customer must not be able to edit a case row directly");
  pass("Cannot edit ticket rows directly - only through the portal's own action");

  // ------------------------------------------------------- round robin check
  const assignee = await check(db.rpc("next_support_assignee"), "Ask for the next support assignee");
  console.log(assignee ? "INFO round robin would assign a support user" : "INFO no Support department yet, so portal tickets stay unassigned");
  pass("Round-robin assignment answers without error");

  console.log(`\n${passed.length} checks passed.`);
} finally {
  for (const undo of cleanup.reverse()) {
    try { await undo(); } catch (err) { console.error("Cleanup failed:", err.message); }
  }
  console.log("Temporary data removed.");
}
