// The external experience: knowledge base, customer projects and deliverables,
// and portal Admins and Users - in a real browser.
//
// One of our people writes and publishes a help article and a customer reads it
// in the support portal; hands a deliverable to the customer, whose User sees
// it but cannot decide and whose Admin approves one and sends another back. The
// customer Admin then manages their company's logins: makes the User an Admin,
// switches them off, and invites a colleague. A partner User sees their deals
// but no commission; the partner Admin sees both.
//
// Everything created is removed afterwards. No email is sent: every address is
// example.com, which is never emailed.
//
// Usage: node scripts/test-external-experience-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";

config({ path: ".env", quiet: true });

const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  throw new Error("This check only targets the local application.");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 6).toUpperCase();
const lower = run.toLowerCase();
const now = () => new Date().toISOString();
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = {
  role: randomUUID(), staff: null, logins: [],
  customer: randomUUID(), buyerAdmin: randomUUID(), buyerUser: randomUUID(),
  partnerAccount: randomUUID(), partner: randomUUID(), sellerAdmin: randomUUID(), sellerUser: randomUUID(),
  project: randomUUID(), first: randomUUID(), second: randomUUID(),
};
const articleTitle = `QA help article ${run}`;
const inviteEmail = `xp-invited-${lower}@example.com`;
let browser;
const pages = [];

async function makeLogin(email, fields) {
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.logins.push(auth.data.user.id);
  await must(db.from("app_user").insert({ id: auth.data.user.id, email, status: "ACTIVE", updatedAt: now(), ...fields }), `Login for ${fields.fullName}`);
  return { id: auth.data.user.id, email, password };
}

async function signedIn(login) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  page.on("dialog", (d) => d.accept());
  pages.push(page);
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(login.email);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  return page;
}

try {
  // --- Setup ------------------------------------------------------------------------
  await must(db.from("security_role").insert({ id: ids.role, name: `QA External ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() }), "Role");
  const staff = await makeLogin(`xp-staff-${lower}@example.com`, { fullName: `QA Staff ${run}`, roleId: ids.role });
  ids.staff = staff.id;
  const customerRole = await must(db.from("security_role").select("id").eq("name", "Customer").single(), "Customer role");
  const partnerRole = await must(db.from("security_role").select("id").eq("name", "Partner").single(), "Partner role");

  await must(db.from("account").insert([
    { id: ids.customer, accountNumber: `QA-XP-C-${run}`, name: `QA XP Customer ${run}`, accountType: "CUSTOMER", ownerUserId: ids.staff, updatedAt: now() },
    { id: ids.partnerAccount, accountNumber: `QA-XP-P-${run}`, name: `QA XP Partner Co ${run}`, accountType: "PARTNER", ownerUserId: ids.staff, updatedAt: now() },
  ]), "Accounts");
  await must(db.from("contact").insert([
    { id: ids.buyerAdmin, accountId: ids.customer, firstName: "Buyer", lastName: `Admin ${run}`, email: `xp-buyer-admin-${lower}@example.com`, updatedAt: now() },
    { id: ids.buyerUser, accountId: ids.customer, firstName: "Buyer", lastName: `User ${run}`, email: `xp-buyer-user-${lower}@example.com`, updatedAt: now() },
    { id: ids.sellerAdmin, accountId: ids.partnerAccount, firstName: "Seller", lastName: `Admin ${run}`, email: `xp-seller-admin-${lower}@example.com`, updatedAt: now() },
    { id: ids.sellerUser, accountId: ids.partnerAccount, firstName: "Seller", lastName: `User ${run}`, email: `xp-seller-user-${lower}@example.com`, updatedAt: now() },
  ]), "Contacts");
  await must(db.from("partner").insert({
    id: ids.partner, partnerNumber: `QA-XP-${run}`, displayName: `QA XP Partner ${run}`, kind: "COMPANY", accountId: ids.partnerAccount,
    partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE", partnerManagerId: ids.staff, defaultCommissionPercent: 10, updatedAt: now(),
  }), "Partner");

  const buyerAdmin = await makeLogin(`xp-buyer-admin-${lower}@example.com`, {
    fullName: `Buyer Admin ${run}`, roleId: customerRole.id, userType: "CUSTOMER", contactId: ids.buyerAdmin, portalScope: "ACCOUNT", portalRole: "ADMIN",
  });
  const buyerUser = await makeLogin(`xp-buyer-user-${lower}@example.com`, {
    fullName: `Buyer User ${run}`, roleId: customerRole.id, userType: "CUSTOMER", contactId: ids.buyerUser, portalScope: "ACCOUNT", portalRole: "USER",
  });
  const sellerAdmin = await makeLogin(`xp-seller-admin-${lower}@example.com`, {
    fullName: `Seller Admin ${run}`, roleId: partnerRole.id, userType: "PARTNER", partnerId: ids.partner, contactId: ids.sellerAdmin, portalRole: "ADMIN",
  });
  const sellerUser = await makeLogin(`xp-seller-user-${lower}@example.com`, {
    fullName: `Seller User ${run}`, roleId: partnerRole.id, userType: "PARTNER", partnerId: ids.partner, contactId: ids.sellerUser, portalRole: "USER",
  });

  await must(db.from("project").insert({
    id: ids.project, projectNumber: `QA-XP-PR-${run}`, name: `QA XP Project ${run}`, accountId: ids.customer, projectManagerId: ids.staff,
    projectType: "CUSTOMER", billingType: "FIXED", status: "PLANNING", currencyCode: "PKR", updatedAt: now(),
  }), "Project");
  await must(db.from("deliverable").insert([
    { id: ids.first, projectId: ids.project, name: `Design pack ${run}`, link: "https://example.com/design", status: "PLANNED", createdById: ids.staff },
    { id: ids.second, projectId: ids.project, name: `Staging site ${run}`, link: "https://example.com/staging", status: "SUBMITTED", submittedAt: now(), createdById: ids.staff },
  ]), "Deliverables");
  pass("Our person, a customer with an Admin and a User, a partner with an Admin and a User, and a project");

  browser = await chromium.launch({ headless: true });

  // --- Knowledge base ------------------------------------------------------------------
  const ours = await signedIn(staff);
  await ours.goto(`${base}/knowledge/new`, { waitUntil: "networkidle" });
  await ours.getByPlaceholder("How to reset your password").fill(articleTitle);
  await ours.locator("textarea").first().fill(`First paragraph ${run}.\n\nSecond paragraph.`);
  await ours.getByRole("button", { name: "Save and publish" }).click();
  await ours.waitForURL(/\/knowledge\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const article = await must(db.from("knowledge_article").select("id, status, visibility, publishedAt, articleNumber").eq("title", articleTitle).single(), "Article");
  assert.equal(article.status, "PUBLISHED");
  assert.equal(article.visibility, "CUSTOMER_PORTAL");
  assert.ok(article.publishedAt && article.articleNumber);
  await ours.goto(`${base}/knowledge`, { waitUntil: "networkidle" });
  await ours.getByText(articleTitle).waitFor({ timeout: 15000 });
  pass("An article is written and published, and listed in the knowledge base");

  // --- Deliverables: handing over -------------------------------------------------------
  await ours.goto(`${base}/projects/${ids.project}?tab=deliverables`, { waitUntil: "networkidle" });
  await ours.getByRole("button", { name: "Hand to the customer" }).click();
  await ours.getByText("With the customer").first().waitFor({ timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));
  const handed = await must(db.from("deliverable").select("status, submittedAt").eq("id", ids.first).single(), "Deliverable");
  assert.equal(handed.status, "SUBMITTED");
  assert.ok(handed.submittedAt);
  pass("A deliverable is handed to the customer from the project");

  // --- Customer User: reads, cannot decide -----------------------------------------------
  const user = await signedIn(buyerUser);
  await user.goto(`${base}/support/knowledge`, { waitUntil: "networkidle" });
  await user.getByText(articleTitle).waitFor({ timeout: 15000 });
  pass("The customer reads the new article in the support portal");

  await user.goto(`${base}/support/projects`, { waitUntil: "networkidle" });
  await user.getByText(`QA XP Project ${run}`).click();
  await user.waitForURL(new RegExp(`/support/projects/${ids.project}`), { timeout: 30000 });
  await user.getByText(`Design pack ${run}`).waitFor({ timeout: 15000 });
  await user.getByText("Your company's portal Admin approves deliverables").waitFor();
  assert.equal(await user.getByRole("button", { name: "Approve" }).count(), 0, "A User has no Approve button");
  const refused = await (async () => {
    // Even straight to the database as the User, a decision is refused.
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    await anon.auth.signInWithPassword({ email: buyerUser.email, password: buyerUser.password });
    return anon.rpc("customer_decide_deliverable", { p_id: ids.first, p_approve: true, p_comment: null });
  })();
  assert.ok(refused.error, "The database refuses a User's decision");
  pass("The customer User sees the project and its deliverables, but cannot approve");

  // --- Customer Admin: approves one, sends one back --------------------------------------
  const admin = await signedIn(buyerAdmin);
  await admin.goto(`${base}/support/projects/${ids.project}`, { waitUntil: "networkidle" });
  const firstItem = admin.locator("li", { hasText: `Design pack ${run}` });
  await firstItem.getByRole("button", { name: "Approve" }).click();
  await admin.locator("li", { hasText: `Design pack ${run}` }).getByText("Approved").waitFor({ timeout: 30000 });
  const secondItem = admin.locator("li", { hasText: `Staging site ${run}` });
  await secondItem.getByRole("button", { name: "Ask for changes" }).click();
  await secondItem.getByPlaceholder("What should be changed?").fill("The logo is the old one.");
  await secondItem.getByRole("button", { name: "Send back for changes" }).click();
  await admin.locator("li", { hasText: `Staging site ${run}` }).getByText("Changes asked for").waitFor({ timeout: 30000 });
  const decided = await must(db.from("deliverable").select("id, status, customerComment, decidedByUserId").in("id", [ids.first, ids.second]), "Decisions");
  const byId = Object.fromEntries(decided.map((d) => [d.id, d]));
  assert.equal(byId[ids.first].status, "APPROVED");
  assert.equal(byId[ids.first].decidedByUserId, buyerAdmin.id);
  assert.equal(byId[ids.second].status, "CHANGES_REQUESTED");
  assert.equal(byId[ids.second].customerComment, "The logo is the old one.");
  const told = await must(db.from("notification").select("title").eq("userId", ids.staff).eq("kind", "APPROVAL_DECIDED"), "Notifications");
  assert.equal(told.length, 2, "The project manager hears about both decisions");
  await db.from("notification").update({ emailStatus: "SKIPPED" }).eq("userId", ids.staff);
  pass("The customer Admin approves one deliverable and sends one back; the project manager is told");

  await ours.goto(`${base}/projects/${ids.project}?tab=deliverables`, { waitUntil: "networkidle" });
  await ours.getByRole("button", { name: "Hand back to the customer" }).waitFor({ timeout: 15000 });
  await ours.getByText("The logo is the old one.").waitFor();
  pass("Our side sees the customer's comment and can hand it back");

  // --- Customer Admin: the team ---------------------------------------------------------
  await admin.goto(`${base}/support/account/team`, { waitUntil: "networkidle" });
  const userRow = admin.locator("tr", { hasText: `Buyer User ${run}` });
  await userRow.getByRole("button", { name: "Make Admin" }).click();
  await admin.locator("tr", { hasText: `Buyer User ${run}` }).getByRole("button", { name: "Make User" }).waitFor({ timeout: 30000 });
  assert.equal((await must(db.from("app_user").select("portalRole").eq("id", buyerUser.id).single(), "Role")).portalRole, "ADMIN");
  await admin.locator("tr", { hasText: `Buyer User ${run}` }).getByRole("button", { name: "Switch off" }).click();
  await admin.locator("tr", { hasText: `Buyer User ${run}` }).getByText("Switched off").waitFor({ timeout: 30000 });
  assert.equal((await must(db.from("app_user").select("status").eq("id", buyerUser.id).single(), "Status")).status, "INACTIVE");
  // The only active Admin cannot step down.
  await admin.locator("tr", { hasText: `Buyer Admin ${run}` }).getByRole("button", { name: "Make User" }).click();
  await admin.getByRole("alert").waitFor({ timeout: 15000 });
  assert.equal((await must(db.from("app_user").select("portalRole").eq("id", buyerAdmin.id).single(), "Role")).portalRole, "ADMIN");
  pass("The Admin changes a colleague's role and switches them off, and cannot leave the company without an Admin");

  await admin.goto(`${base}/support/account/team`, { waitUntil: "networkidle" });
  const inviteCard = admin.locator("div.rounded-lg, div[class*=\"rounded\"]", { has: admin.getByText("Invite a colleague", { exact: true }) }).filter({ has: admin.locator("input") }).last();
  const inputs = inviteCard.locator("input");
  await inputs.nth(0).fill("Invited");
  await inputs.nth(1).fill(`Colleague ${run}`);
  await inputs.nth(2).fill(inviteEmail);
  await admin.getByRole("button", { name: "Invite", exact: true }).click();
  await admin.getByText(/The login is ready|Invited\./).waitFor({ timeout: 30000 });
  const invited = await must(db.from("app_user").select("id, userType, portalRole, status, contactId").eq("email", inviteEmail).single(), "Invited login");
  ids.logins.push(invited.id);
  assert.deepEqual([invited.userType, invited.portalRole, invited.status], ["CUSTOMER", "USER", "ACTIVE"]);
  const invitedContact = await must(db.from("contact").select("accountId").eq("id", invited.contactId).single(), "Invited contact");
  assert.equal(invitedContact.accountId, ids.customer);
  await admin.reload({ waitUntil: "networkidle" });
  await admin.getByText(`Invited Colleague ${run}`).waitFor({ timeout: 15000 });
  pass("The Admin invites a colleague, who gets a User login at the same company");

  // --- Partner User and Admin -------------------------------------------------------------
  const seller = await signedIn(sellerUser);
  await seller.goto(`${base}/portal`, { waitUntil: "networkidle" });
  await seller.getByText("Your deals").first().waitFor({ timeout: 15000 });
  assert.equal(await seller.getByText("Paid to you").count(), 0, "No commission tiles");
  assert.equal(await seller.getByText("Recent commission").count(), 0, "No commission list");
  assert.equal(await seller.getByRole("link", { name: "Commission", exact: true }).count(), 0, "No Commission in the menu");
  await seller.goto(`${base}/portal/commissions`, { waitUntil: "networkidle" });
  await seller.getByText("Commission is for your company's portal Admins").waitFor({ timeout: 15000 });
  await seller.goto(`${base}/portal/account/team`, { waitUntil: "networkidle" });
  await seller.getByText(`Seller Admin ${run}`).waitFor({ timeout: 15000 });
  assert.equal(await seller.getByRole("button", { name: "Invite", exact: true }).count(), 0, "A User cannot invite");
  pass("A partner User sees their deals and team, but no commission and no team controls");

  const sellerBoss = await signedIn(sellerAdmin);
  await sellerBoss.goto(`${base}/portal`, { waitUntil: "networkidle" });
  await sellerBoss.getByText("Paid to you").waitFor({ timeout: 15000 });
  await sellerBoss.getByRole("link", { name: "Commission", exact: true }).first().waitFor();
  pass("The partner Admin sees commission");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} catch (err) {
  // What each signed-in page was showing, for working out what went wrong.
  console.error(`Screenshots of each signed-in page are in ${tmpdir()}.`);
  for (const [i, p] of pages.entries()) await p.screenshot({ path: join(tmpdir(), `external-experience-${i}.png`), fullPage: true }).catch(() => {});
  throw err;
} finally {
  if (browser) await browser.close().catch(() => {});
  const failures = [];
  const clean = async (what, fn) => {
    try {
      const r = await fn();
      if (r?.error) failures.push(`${what}: ${r.error.message}`);
    } catch (err) {
      failures.push(`${what}: ${err.message}`);
    }
  };
  const article = await db.from("knowledge_article").select("id").eq("title", articleTitle);
  const articleIds = (article.data ?? []).map((a) => a.id);
  await clean("articles", () => db.from("knowledge_article").delete().in("id", articleIds));
  await clean("deliverables", () => db.from("deliverable").delete().eq("projectId", ids.project));
  await clean("project", () => db.from("project").delete().eq("id", ids.project));
  await clean("notifications", () => db.from("notification").delete().in("userId", [ids.staff, ...ids.logins].filter(Boolean)));
  await clean("partner contacts", () => db.from("partner_contact").delete().eq("partnerId", ids.partner));
  // Portal logins point at the partner and contacts, and the accounts at our
  // person: portal logins first, then the companies, then our person.
  const portalLogins = ids.logins.filter((id) => id !== ids.staff);
  const removeLogin = async (id) => {
    await clean("sign-ins", () => db.from("login_event").delete().eq("userId", id));
    await clean("login", () => db.from("app_user").delete().eq("id", id));
    await db.auth.admin.deleteUser(id).catch(() => {});
  };
  for (const id of portalLogins) await removeLogin(id);
  await clean("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await clean("contacts", () => db.from("contact").delete().in("accountId", [ids.customer, ids.partnerAccount]));
  await clean("accounts", () => db.from("account").delete().in("id", [ids.customer, ids.partnerAccount]));
  for (const id of ids.staff ? [ids.staff] : []) {
    await clean("sign-ins", () => db.from("login_event").delete().eq("userId", id));
    await clean("login", () => db.from("app_user").delete().eq("id", id));
    await db.auth.admin.deleteUser(id).catch(() => {});
  }
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.project, ids.first, ids.second, ids.customer, ids.partnerAccount, ids.partner, ...ids.logins, ...articleIds]));
  await clean("role", () => db.from("security_role").delete().eq("id", ids.role));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
