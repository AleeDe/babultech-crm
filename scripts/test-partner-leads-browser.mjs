// A partner working leads through the portal screens, in a real browser.
//
// scripts/test-partner-leads.mjs proves the boundary in the database; this
// checks the screens a partner uses: adding a lead, logging a follow-up and
// closing it, editing, being refused for somebody already on file without
// being told who, importing a list, composing an email, and converting.
//
// Nothing is emailed - the compose screen is opened, not sent. Everything
// created is removed afterwards.
//
// Usage: node scripts/test-partner-leads-browser.mjs http://localhost:3100
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

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 6).toUpperCase();
const tag = run.toLowerCase();
const now = () => new Date().toISOString();
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
const step = (no, title) => { console.log(`\n${no}  ${title}`); console.log("─".repeat(64)); };
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = {
  partnerAccount: randomUUID(), partner: randomUUID(), person: randomUUID(), login: null,
  ourLead: randomUUID(),
};
let browser;

try {
  step("00", "A partner with a portal login, and one of our own leads");

  const owner = await must(
    db.from("app_user").select("id").eq("userType", "INTERNAL").is("deletedAt", null).limit(1).single(),
    "Find an internal owner",
  );
  await must(db.from("account").insert({
    id: ids.partnerAccount, accountNumber: `QPLB-${run}`, name: `QA Portal Leads ${run}`,
    accountType: "PARTNER", ownerUserId: owner.id, updatedAt: now(),
  }), "Create the partner's company");
  await must(db.from("contact").insert({
    id: ids.person, accountId: ids.partnerAccount, firstName: "Portal", lastName: `Person ${run}`,
    email: `qplb-${tag}@example.com`, updatedAt: now(),
  }), "Create the partner's person");
  await must(db.from("partner").insert({
    id: ids.partner, partnerNumber: `QPLBP-${run}`, displayName: `QA Portal Leads ${run}`, kind: "COMPANY",
    accountId: ids.partnerAccount, partnerType: "ACCOUNT_MANAGEMENT", status: "ACTIVE",
    partnerManagerId: owner.id, defaultCommissionPercent: 10, email: `qplb-${tag}@example.com`, updatedAt: now(),
  }), "Create the partner");
  const role = await must(db.from("security_role").select("id").eq("name", "Partner").single(), "Find the Partner role");
  const email = `qplb-${tag}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.login = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.login, fullName: `QA Portal ${run}`, email, roleId: role.id, userType: "PARTNER",
    partnerId: ids.partner, contactId: ids.person, status: "ACTIVE", updatedAt: now(),
  }), "Create the login");

  await must(db.from("lead").insert({
    id: ids.ourLead, leadNumber: `QPLB-OURS-${run}`, firstName: "Omar", lastName: `Ours ${run}`,
    email: `qplb-omar-${tag}@example.com`, ownerUserId: owner.id, status: "NEW", updatedAt: now(),
  }), "Create our own lead");
  pass("Partner, login and one of our leads ready");

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  step("01", "A new lead, through the form");

  await page.goto(`${base}/portal/leads`, { waitUntil: "networkidle" });
  assert.ok(await page.getByRole("link", { name: "Leads" }).first().isVisible(), "Leads is on the portal menu");
  await page.getByRole("link", { name: /Add your first lead|New lead/ }).first().click();
  await page.waitForURL(/\/portal\/leads\/new/);
  await page.locator('input[name="firstName"]').fill("Lina");
  await page.locator('input[name="lastName"]').fill(`Lead ${run}`);
  await page.locator('input[name="companyName"]').fill(`Lina Traders ${run}`);
  await page.locator('input[name="email"]').fill(`qplb-lina-${tag}@example.com`);
  await page.getByRole("button", { name: "Create lead" }).click();
  await page.waitForURL(/\/portal\/leads\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const leadId = page.url().split("/").pop();
  await page.getByRole("heading", { name: `Lina Lead ${run}` }).waitFor({ timeout: 20000 });
  pass("Created from the form, and opened on its own page");

  step("02", "A follow-up, logged and closed");

  await page.getByLabel("Kind of activity").selectOption("TASK");
  await page.locator('input[name="subject"]').fill(`Call back about pricing ${run}`);
  await page.locator('input[name="dueAt"]').fill(new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Add" }).click();
  await page.getByText(`Call back about pricing ${run}`).waitFor({ timeout: 30000 });
  assert.ok(await page.getByText("To do", { exact: true }).isVisible(), "It shows as to do");
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByText("Completed", { exact: true }).waitFor({ timeout: 30000 });
  pass("Follow-up logged as to do, then marked done");

  step("03", "Editing");

  await page.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/edit$/);
  await page.locator('select[name="status"]').selectOption("CONTACTED");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(new RegExp(`/portal/leads/${leadId}$`), { timeout: 30000 });
  await page.getByText("Contacted", { exact: true }).first().waitFor({ timeout: 20000 });
  pass("Status changed to Contacted through the edit form");

  step("04", "Somebody already on file is refused, without saying who");

  await page.goto(`${base}/portal/leads/new`, { waitUntil: "networkidle" });
  await page.locator('input[name="firstName"]').fill("Omar");
  await page.locator('input[name="lastName"]').fill("Copy");
  await page.locator('input[name="email"]').fill(`QPLB-OMAR-${tag}@example.com`);
  await page.getByRole("button", { name: "Create lead" }).click();
  await page.getByText(/Someone with this email address is already in our records/).waitFor({ timeout: 30000 });
  let body = await page.locator("body").innerText();
  assert.ok(!body.includes(`Omar Ours ${run}`), "Our lead is not named to a partner");
  assert.equal(await page.getByRole("link", { name: /^Open / }).count(), 0, "And there is no link to it");
  pass("Refused with 'already in our records', naming nobody and linking nowhere");

  step("05", "Importing a list");

  await page.goto(`${base}/portal/leads/import`, { waitUntil: "networkidle" });
  await page.getByLabel("Paste your list").fill([
    "First Name,Last Name,Email",
    `Nora,New ${run},qplb-nora-${tag}@example.com`,
    `Omar,Again ${run},qplb-omar-${tag}@example.com`,
  ].join("\n"));
  await page.getByRole("button", { name: /Import 2 leads/ }).click();
  await page.getByText(/Imported 1 lead\./).waitFor({ timeout: 30000 });
  body = await page.locator("body").innerText();
  assert.match(body, /Row 2, Omar Again [A-Z0-9]+: Already in our records \(same email address\)/);
  pass("One imported; the known person left out with the reason, and no name");

  step("06", "Composing an email");

  await page.goto(`${base}/portal/leads/email?ids=${leadId}`, { waitUntil: "networkidle" });
  body = await page.locator("body").innerText();
  assert.match(body, /Going to 1 person/);
  assert.match(body, new RegExp(`QA Portal Leads ${run} via BabulTech`), "Sent under the partner's name");
  assert.match(body, new RegExp(`replies go to qplb-${tag}@example.com`, "i"), "With replies to the partner");
  pass("Compose shows one recipient, sent as the partner via BabulTech, replies to them");

  step("07", "Converting");

  await page.goto(`${base}/portal/leads/${leadId}/convert`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Convert lead" }).click();
  await page.waitForURL(/\/portal\/customers\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await page.getByText(`Lina Traders ${run} - new business`).first().waitFor({ timeout: 20000 });
  const lead = await must(db.from("lead").select("status, convertedAccountId, convertedOpportunityId").eq("id", leadId).single(), "Re-read the lead");
  assert.equal(lead.status, "CONVERTED");
  ids.account = lead.convertedAccountId;
  ids.deal = lead.convertedOpportunityId;
  pass("Converted: the new account opens with its deal on it");

  step("08", "Nothing threw");
  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");

  console.log(`\n${"═".repeat(64)}\n${passed.length} checks passed.\n${"═".repeat(64)}\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  const failures = [];
  const step = async (what, fn) => {
    const r = await fn();
    if (r?.error) failures.push(`${what}: ${r.error.message}`);
  };
  const { data: theirLeads } = await db.from("lead").select("id").eq("referredByPartnerId", ids.partner);
  const leadIds = [...(theirLeads ?? []).map((l) => l.id), ids.ourLead];
  const { data: accounts } = await db.from("account").select("id").eq("sourcePartnerId", ids.partner);
  const accountIds = (accounts ?? []).map((a) => a.id);
  const { data: deals } = await db.from("opportunity").select("id").eq("sourcePartnerId", ids.partner);
  const dealIds = (deals ?? []).map((d) => d.id);

  if (ids.login) await step("activities", () => db.from("activity").delete().eq("ownerUserId", ids.login));
  await step("leads", () => db.from("lead").delete().in("id", leadIds));
  if (dealIds.length) {
    const { data: records } = await db.from("partner_commission").select("id").in("opportunityId", dealIds);
    const recordIds = (records ?? []).map((r) => r.id);
    if (recordIds.length) await step("commission history", () => db.from("audit_history").delete().in("entityId", recordIds));
    await step("deals", () => db.from("opportunity").delete().in("id", dealIds));
  }
  if (ids.login) {
    await step("login", () => db.from("app_user").delete().eq("id", ids.login));
    await db.auth.admin.deleteUser(ids.login).catch(() => {});
  }
  if (accountIds.length) await step("contacts", () => db.from("contact").delete().in("accountId", accountIds));
  await step("person", () => db.from("contact").delete().eq("id", ids.person));
  if (accountIds.length) await step("accounts", () => db.from("account").delete().in("id", accountIds));
  await step("partner", () => db.from("partner").delete().eq("id", ids.partner));
  await step("partner company", () => db.from("account").delete().eq("id", ids.partnerAccount));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
