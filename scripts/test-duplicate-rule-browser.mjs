// The duplicate rule on screen, in a real browser, on real records.
//
// scripts/test-duplicate-rule.mjs proves what the database tells each kind of
// user. This checks that the screens pass it on:
//
//   - the lead and contact forms refuse a known person, name them, and link to them;
//   - the lead import leaves known people out and lists who and why;
//   - converting a member who is already a lead links them, and says so;
//   - the convert screen uses the contact the person already is;
//   - the partner's conflict box says that the person is known, never who.
//
// Records are made for the run and removed afterwards. Numbers are random per
// run, because the rule matches on their last nine digits.
//
// Usage: node scripts/test-duplicate-rule-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

config({ path: ".env", quiet: true });

const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) {
  throw new Error("This check only targets the local application.");
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const run = randomUUID().slice(0, 6).toUpperCase();
const tag = run.toLowerCase();
const now = () => new Date().toISOString();
const nine = () => String(Math.floor(Math.random() * 9e8) + 1e8);
const intl = (n) => `+92 ${n.slice(0, 3)} ${n.slice(3)}`;
const local = (n) => `0${n}`;
const passed = [];
const errors = [];

const pass = (what) => {
  passed.push(what);
  console.log(`  PASS  ${what}`);
};
const step = (no, title) => {
  console.log(`\n${no}  ${title}`);
  console.log("─".repeat(64));
};
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = {
  role: randomUUID(), staff: null, partnerUser: null,
  leadA: randomUUID(), leadB: randomUUID(), member: randomUUID(),
  customer: randomUUID(), kamran: randomUUID(),
  bilalAccount: randomUUID(), bilal: randomUUID(),
  partnerAccount: randomUUID(), partnerPerson: randomUUID(), partner: randomUUID(),
  importedLeads: [], opportunities: [],
};

let browser;

async function makeLogin(email, fields) {
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(`Create identity: ${auth.error.message}`);
  const id = auth.data.user.id;
  await must(db.from("app_user").insert({ id, email, status: "ACTIVE", updatedAt: now(), ...fields }), `Create ${email}`);
  return { id, email, password };
}

async function signIn(context, who) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(who.email);
  await page.locator('input[name="password"]').fill(who.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  return page;
}

try {
  // ─────────────────────────────────────────────────────────────────────
  step("00", "People already on file, and somebody to find them");
  // ─────────────────────────────────────────────────────────────────────

  await must(db.from("security_role").insert({
    id: ids.role, name: `Duplicate browser QA ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now(),
  }), "Create the role");
  const staff = await makeLogin(`drb-staff-${tag}@example.com`, { fullName: `DRB Staff ${run}`, roleId: ids.role });
  ids.staff = staff.id;

  const amnaNumber = nine();
  await must(db.from("lead").insert({
    id: ids.leadA, leadNumber: `DRB-${run}-1`, firstName: "Amna", lastName: `Known ${run}`,
    companyName: `Amna Foods ${run}`, email: `drb-amna-${tag}@example.com`, phone: intl(amnaNumber),
    status: "NEW", ownerUserId: staff.id, updatedAt: now(),
  }), "Create Amna's lead");

  const kamranNumber = nine();
  await must(db.from("account").insert({
    id: ids.customer, accountNumber: `DRB-A1-${run}`, name: `QA DRB Customer ${run}`,
    accountType: "CUSTOMER", ownerUserId: staff.id, updatedAt: now(),
  }), "Create a customer");
  await must(db.from("contact").insert({
    id: ids.kamran, accountId: ids.customer, firstName: "Kamran", lastName: `Known ${run}`,
    email: `drb-kamran-${tag}@example.com`, mobile: intl(kamranNumber), updatedAt: now(),
  }), "Create Kamran, their contact");

  // Amna again, from a campaign list.
  await must(db.from("campaign_member").insert({
    id: ids.member, firstName: "Amna", lastName: `Known ${run}`,
    email: `DRB-AMNA-${tag}@example.com`, ownerUserId: staff.id, updatedAt: now(),
  }), "Add Amna as a campaign member");

  // Bilal: a lead, and then - while the lead was being worked - a contact.
  await must(db.from("lead").insert({
    id: ids.leadB, leadNumber: `DRB-${run}-2`, firstName: "Bilal", lastName: `Later ${run}`,
    companyName: `Bilal Lead Co ${run}`, email: `drb-bilal-${tag}@example.com`,
    status: "QUALIFIED", ownerUserId: staff.id, updatedAt: now(),
  }), "Create Bilal's lead");
  await must(db.from("account").insert({
    id: ids.bilalAccount, accountNumber: `DRB-A2-${run}`, name: `QA DRB Bilal Traders ${run}`,
    accountType: "PROSPECT", ownerUserId: staff.id, updatedAt: now(),
  }), "Create Bilal's company");
  await must(db.from("contact").insert({
    id: ids.bilal, accountId: ids.bilalAccount, firstName: "Bilal", lastName: `Later ${run}`,
    email: `drb-bilal-${tag}@example.com`, updatedAt: now(),
  }), "Add Bilal as their contact");

  // A partner with a portal login.
  await must(db.from("account").insert({
    id: ids.partnerAccount, accountNumber: `DRB-P-${run}`, name: `QA DRB Partner ${run}`,
    accountType: "PARTNER", ownerUserId: staff.id, updatedAt: now(),
  }), "Create the partner's company");
  await must(db.from("contact").insert({
    id: ids.partnerPerson, accountId: ids.partnerAccount, firstName: "Partner", lastName: `Person ${run}`,
    email: `drb-partner-${tag}@example.com`, updatedAt: now(),
  }), "Create the partner's person");
  await must(db.from("partner").insert({
    id: ids.partner, partnerNumber: `DRB-PP-${run}`, displayName: `QA DRB Partner ${run}`, kind: "COMPANY",
    accountId: ids.partnerAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: staff.id, updatedAt: now(),
  }), "Create the partner");
  const partnerRole = await must(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const partnerLogin = await makeLogin(`drb-partner-${tag}@example.com`, {
    fullName: `QA DRB Partner ${run}`, roleId: partnerRole.id, userType: "PARTNER",
    partnerId: ids.partner, contactId: ids.partnerPerson,
  });
  ids.partnerUser = partnerLogin.id;
  pass("A lead, a customer's contact, a campaign member, a late contact and a partner");

  browser = await chromium.launch({ headless: true });
  const staffContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await signIn(staffContext, staff);

  // ─────────────────────────────────────────────────────────────────────
  step("01", "The lead form refuses a known address, and links to it");
  // ─────────────────────────────────────────────────────────────────────

  await page.goto(`${base}/leads/new`, { waitUntil: "networkidle" });
  await page.locator('input[name="firstName"]').fill("Somebody");
  await page.locator('input[name="lastName"]').fill(`Else ${run}`);
  await page.locator('input[name="email"]').fill(`  DRB-Amna-${tag}@Example.com `);
  await page.getByRole("button", { name: "Create lead" }).click();
  await page.getByText(/This lead already exists/).waitFor({ timeout: 30000 });
  const leadLink = page.getByRole("link", { name: new RegExp(`Open DRB-${run}-1`) });
  assert.equal(await leadLink.getAttribute("href"), `/leads/${ids.leadA}`, "The link must open the lead that exists");
  assert.ok(await page.getByText("Already on file").isVisible(), "And the email field is marked");
  assert.ok(page.url().endsWith("/leads/new"), "Nothing was saved, so the form stays");
  pass("Refused, naming the lead, with a link to it and the field marked");

  // ─────────────────────────────────────────────────────────────────────
  step("02", "The contact form refuses a known number, written another way");
  // ─────────────────────────────────────────────────────────────────────

  await page.goto(`${base}/contacts/new?accountId=${ids.customer}`, { waitUntil: "networkidle" });
  await page.locator('input[name="firstName"]').fill("Kamran");
  await page.locator('input[name="lastName"]').fill(`Twice ${run}`);
  await page.locator('input[name="whatsapp"]').fill(local(kamranNumber));
  await page.getByRole("button", { name: "Create contact" }).click();
  await page.getByText(/This contact already exists/).waitFor({ timeout: 30000 });
  const contactLink = page.getByRole("link", { name: new RegExp(`Open Kamran Known ${run} at QA DRB Customer ${run}`) });
  assert.equal(await contactLink.getAttribute("href"), `/contacts/${ids.kamran}`);
  pass("A WhatsApp number matching a contact's mobile is refused, linking to that contact");

  // ─────────────────────────────────────────────────────────────────────
  step("03", "The import leaves known people out, and lists them");
  // ─────────────────────────────────────────────────────────────────────

  await page.goto(`${base}/leads/import`, { waitUntil: "networkidle" });
  await page.locator("textarea").first().fill([
    "First Name,Last Name,Email,Phone",
    `Nida,New ${run},drb-nida-${tag}@example.com,`,
    `Amna,Copy ${run},drb-amna-${tag}@example.com,`,
    `Nida,Again ${run},DRB-NIDA-${tag}@example.com,`,
  ].join("\n"));
  await page.getByRole("button", { name: /Import 3 leads/ }).click();
  await page.getByText(/Imported 1 lead\./).waitFor({ timeout: 60000 });
  let body = await page.locator("body").innerText();
  assert.match(body, /2 rows were left\s+out/, "Two rows were left out");
  assert.match(body, new RegExp(`Row 2, Amna Copy ${run}: Already a lead: Amna Known ${run} \\(DRB-${run}-1\\)`), "Row 2 is Amna, already a lead");
  assert.match(body, new RegExp(`Row 3, Nida Again ${run}: Same email address as row 1 of this file`), "Row 3 repeats row 1");
  const imported = await must(
    db.from("lead").select("id").ilike("email", `drb-nida-${tag}@example.com`),
    "Find the imported lead",
  );
  ids.importedLeads.push(...imported.map((l) => l.id));
  assert.equal(imported.length, 1, "Exactly the one new person was imported");
  pass("One new lead imported; the known lead and the repeat inside the file are listed with reasons");

  // ─────────────────────────────────────────────────────────────────────
  step("04", "Converting a member who is already a lead links them");
  // ─────────────────────────────────────────────────────────────────────

  await page.goto(`${base}/campaign-members/${ids.member}`, { waitUntil: "networkidle" });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Convert to lead" }).click();
  await page.getByText(/is already\s+a lead/).waitFor({ timeout: 30000 });
  body = await page.locator("body").innerText();
  assert.match(body, new RegExp(`a lead \\(DRB-${run}-1\\), with the same email address`), "It names the lead and why");
  assert.match(body, /no second record was made/i);
  assert.equal(
    await page.getByRole("link", { name: "Open the lead" }).first().getAttribute("href"),
    `/leads/${ids.leadA}`,
  );
  const member = await must(db.from("campaign_member").select("leadId, convertedAt").eq("id", ids.member).single(), "Re-read the member");
  assert.equal(member.leadId, ids.leadA, "The member points at Amna's lead");
  pass("The member is linked to Amna's lead, the screen says so, and no lead was made");

  // ─────────────────────────────────────────────────────────────────────
  step("05", "Converting a lead who is already a contact uses that contact");
  // ─────────────────────────────────────────────────────────────────────

  await page.goto(`${base}/leads/${ids.leadB}/convert`, { waitUntil: "networkidle" });
  body = await page.locator("body").innerText();
  assert.match(body, new RegExp(`Bilal Later ${run} is already a contact at QA DRB Bilal Traders ${run}`));
  assert.match(body, new RegExp(`It goes on QA DRB Bilal Traders ${run}`), "The account is settled, not a choice");
  await page.getByRole("button", { name: "Convert lead" }).click();
  await page.waitForURL(/\/opportunities\//, { timeout: 60000 });
  const converted = await must(
    db.from("lead").select("convertedContactId, convertedAccountId, convertedOpportunityId").eq("id", ids.leadB).single(),
    "Re-read Bilal's lead",
  );
  if (converted.convertedOpportunityId) ids.opportunities.push(converted.convertedOpportunityId);
  assert.equal(converted.convertedContactId, ids.bilal, "Conversion must use the contact he already is");
  assert.equal(converted.convertedAccountId, ids.bilalAccount, "On his contact's account");
  const onAccount = await must(db.from("contact").select("id").eq("accountId", ids.bilalAccount), "Count contacts");
  assert.equal(onAccount.length, 1, "No second contact was made");
  pass("The convert screen says who he already is, and conversion uses that contact and account");

  // ─────────────────────────────────────────────────────────────────────
  step("06", "The partner is told that, never who");
  // ─────────────────────────────────────────────────────────────────────

  const partnerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const portal = await signIn(partnerContext, partnerLogin);
  await portal.goto(`${base}/portal/customers/new`, { waitUntil: "networkidle" });
  await portal.locator("#accountName").fill(`Nothing Like It ${run}`);
  await portal.locator("#email").fill(`drb-kamran-${tag}@example.com`);
  await portal.locator("#email").blur();
  await portal.getByText(/Someone with this email address is already in our records\./).waitFor({ timeout: 30000 });
  body = await portal.locator("body").innerText();
  assert.ok(!body.includes(`QA DRB Customer ${run}`), "The customer is never named to a partner");
  assert.ok(!body.includes("Kamran"), "Nor the person");
  assert.equal(await portal.getByRole("button", { name: /Give me details/ }).count(), 0, "And there is nothing to reveal");
  pass("The conflict box says the address is known, and shows nothing about whose it is");

  await portal.locator("#firstName").fill("Kamran");
  await portal.locator("#lastName").fill(`Poached ${run}`);
  await portal.getByRole("button", { name: "Create customer" }).click();
  await portal.getByText(/so this contact cannot be added again/).waitFor({ timeout: 30000 });
  const made = await must(db.from("account").select("id").eq("name", `Nothing Like It ${run}`), "Look for the account");
  assert.equal(made.length, 0, "Nothing was created");
  pass("Registering them anyway is refused, and nothing is created");

  // ─────────────────────────────────────────────────────────────────────
  step("07", "Nothing threw in the browser");
  // ─────────────────────────────────────────────────────────────────────

  assert.equal(
    errors.length, 0,
    `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`,
  );
  pass("No runtime errors on any of these pages");

  console.log(`\n${"═".repeat(64)}`);
  console.log(`${passed.length} checks passed.`);
  console.log(`${"═".repeat(64)}\n`);
} finally {
  if (browser) await browser.close().catch(() => {});

  // What points at what decides the order: the member at Amna's lead; Bilal's
  // lead at his deal and contact; the deal at the account; the partner's login
  // at their person; the partner at its company; every account at the staff
  // login, which goes last with its role.
  const failures = [];
  const run1 = async (what, fn) => {
    try {
      const r = await fn();
      if (r?.error) failures.push(`${what}: ${r.error.message}`);
    } catch (err) {
      failures.push(`${what}: ${err.message}`);
    }
  };
  await run1("member", () => db.from("campaign_member").delete().eq("id", ids.member));
  await run1("leads", () => db.from("lead").delete().in("id", [ids.leadA, ids.leadB, ...ids.importedLeads]));
  if (ids.opportunities.length) {
    await run1("deals", () => db.from("opportunity").delete().in("id", ids.opportunities));
  }
  if (ids.partnerUser) {
    await run1("partner login", () => db.from("app_user").delete().eq("id", ids.partnerUser));
    await run1("partner identity", () => db.auth.admin.deleteUser(ids.partnerUser));
  }
  await run1("contacts", () => db.from("contact").delete().in("id", [ids.kamran, ids.bilal, ids.partnerPerson]));
  await run1("customer accounts", () => db.from("account").delete().in("id", [ids.customer, ids.bilalAccount]));
  await run1("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await run1("partner account", () => db.from("account").delete().eq("id", ids.partnerAccount));
  if (ids.staff) {
    await run1("staff login", () => db.from("app_user").delete().eq("id", ids.staff));
    await run1("staff identity", () => db.auth.admin.deleteUser(ids.staff));
  }
  await run1("role", () => db.from("security_role").delete().eq("id", ids.role));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
