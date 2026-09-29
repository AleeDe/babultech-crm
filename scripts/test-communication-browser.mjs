// Communication: sender addresses, templates, mass email to contacts and
// campaign members, consent, opt-out and the timeline - in a real browser.
//
// A temporary administrator saves a template, emails two contacts (only the
// one who agreed to marketing is included), opts the other out, and emails a
// campaign member. The messages are queued and then marked "Test address, not
// sent": every address is example.com, which the mailer never sends to.
//
// Sales and Support sender addresses are created the first time the senders
// are read, and are kept: they are real configuration, not test data.
// Everything else created is removed afterwards.
//
// Usage: node scripts/test-communication-browser.mjs http://localhost:3100
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
  role: randomUUID(), user: null, account: randomUUID(), agreed: randomUUID(), notAgreed: randomUUID(), member: randomUUID(), campaign: randomUUID(),
};
const addr = (who) => `${who}-${lower}@example.com`;
let browser;

try {
  await must(db.from("security_role").insert({
    id: ids.role, name: `QA Comms ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now(),
  }), "Create the role");
  const email = `comms-qa-${lower}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.user, fullName: `QA Comms ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now(),
  }), "Create the user");
  await must(db.from("account").insert({
    id: ids.account, accountNumber: `QA-CM-${run}`, name: `QA Comms Co ${run}`, accountType: "CUSTOMER", ownerUserId: ids.user, updatedAt: now(),
  }), "Create an account");
  await must(db.from("contact").insert([
    { id: ids.agreed, accountId: ids.account, firstName: "Agreed", lastName: `Comms ${run}`, email: addr("agreed"), communicationConsent: true, updatedAt: now() },
    { id: ids.notAgreed, accountId: ids.account, firstName: "Unasked", lastName: `Comms ${run}`, email: addr("unasked"), communicationConsent: false, updatedAt: now() },
  ]), "Create two contacts");
  const type = await must(db.from("campaign_type").select("id").limit(1).single(), "A campaign type");
  await must(db.from("campaign").insert({
    id: ids.campaign, campaignNumber: `QA-CM-C-${run}`, name: `QA Comms campaign ${run}`, campaignTypeId: type.id, ownerUserId: ids.user, status: "ACTIVE", updatedAt: now(),
  }), "Create a campaign");
  await must(db.from("campaign_member").insert({
    id: ids.member, firstName: "Member", lastName: `Comms ${run}`, email: addr("member"), campaignId: ids.campaign, ownerUserId: ids.user, updatedAt: now(),
  }), "Create a campaign member");
  pass("An administrator, two contacts (one agreed to marketing) and a campaign member");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  // --- Senders and templates -------------------------------------------------
  await page.goto(`${base}/email/senders`, { waitUntil: "networkidle" });
  await page.locator("td", { hasText: "sales@" }).first().waitFor({ timeout: 20000 });
  if (process.env.QA_TRACE) console.log("SENDERS PAGE:", (await page.locator("main").innerText()).slice(0, 800));
  const senders = await must(db.from("email_sender").select("label, fromAddress, isDefault"), "Senders");
  const sales = senders.find((s) => s.label === "Sales");
  assert.ok(sales && senders.some((s) => s.label === "Support"), "Sales and Support exist");
  pass(`Sender addresses: Sales (${sales.fromAddress}) and Support`);

  await page.goto(`${base}/email/templates`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New template" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").nth(0).fill(`QA template ${run}`);
  await dialog.getByRole("textbox").nth(1).fill(`Hello from {{senderName}} ${run}`);
  await dialog.getByRole("textbox").nth(2).fill(`Dear {{firstName}},\n\nNews for {{companyName}}.`);
  await page.getByRole("button", { name: "Save template" }).click();
  await page.getByText(`QA template ${run}`).waitFor({ timeout: 15000 });
  const template = await must(db.from("email_template").select("id, createdById").eq("name", `QA template ${run}`).single(), "Template");
  assert.equal(template.createdById, ids.user);
  pass("A template is saved");

  // --- Emailing contacts ------------------------------------------------------
  await page.goto(`${base}/email/compose?type=Contact&ids=${ids.agreed},${ids.notAgreed}`, { waitUntil: "networkidle" });
  await page.getByText("Going to 1 person").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "See who" }).click();
  await page.getByText("Has not agreed to marketing").waitFor({ timeout: 10000 });
  pass("Only the contact who agreed to marketing is included by default");

  await page.locator("select").first().selectOption({ label: `QA template ${run}` });
  const subject = await page.locator('input[placeholder="A quick question about {{companyName}}"]').inputValue();
  assert.equal(subject, `Hello from {{senderName}} ${run}`, "The template fills the subject");
  const preview = await page.locator("div.whitespace-pre-wrap, p.whitespace-pre-wrap").first().innerText();
  assert.match(preview, new RegExp(`Dear Agreed,[\\s\\S]*News for QA Comms Co ${run}`), "The preview fills the placeholders");
  pass("Choosing the template fills the message, and the preview fills in the person");

  await page.getByRole("button", { name: /^Send to 1 person/ }).click();
  await page.waitForURL(/\/leads\/email\/sends\/[0-9a-f-]{36}/, { timeout: 30000 });
  const batchId = page.url().match(/sends\/([0-9a-f-]{36})/)[1];
  const batch = await must(db.from("email_batch").select("audienceType, fromAddress, templateId, skippedCount").eq("id", batchId).single(), "Batch");
  assert.deepEqual(batch, { audienceType: "Contact", fromAddress: sales.fromAddress, templateId: template.id, skippedCount: 1 });
  await page.getByText(`Agreed Comms ${run}`).first().waitFor({ timeout: 20000 });
  pass("The send goes as Sales, from the template, and its page names the contact");

  // The job marks test addresses rather than sending them.
  let failReason = null;
  for (let i = 0; i < 20 && !failReason; i += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    const act = await db.from("activity").select("failReason, sentAt").eq("batchId", batchId).single();
    failReason = act.data?.failReason ?? null;
    assert.equal(act.data?.sentAt ?? null, null, "Nothing is sent to a test address");
  }
  assert.equal(failReason, "Test address, not sent");
  pass("The background job leaves test addresses unsent");

  // --- Opt-out and the timeline -------------------------------------------------
  await page.goto(`${base}/contacts/${ids.notAgreed}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Opt out of email" }).click();
  await page.getByRole("button", { name: "Opted out of email" }).waitFor({ timeout: 20000 });
  const supp = await must(db.from("email_suppression").select("reason").eq("email", addr("unasked")).single(), "Suppression");
  assert.equal(supp.reason, "UNSUBSCRIBED");
  await page.goto(`${base}/email/compose?type=Contact&consent=0&ids=${ids.notAgreed}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "See who" }).click();
  await page.getByText("Asked not to be emailed").waitFor({ timeout: 10000 });
  pass("Opting a contact out suppresses the address, even with the consent filter off");

  await page.goto(`${base}/contacts/${ids.agreed}`, { waitUntil: "networkidle" });
  await page.getByText("Timeline").first().waitFor({ timeout: 20000 });
  assert.match(await page.locator("body").innerText(), new RegExp(`Email: Hello from \\{\\{senderName\\}\\} ${run}`));
  pass("The contact's timeline shows the email");

  // --- Campaign members --------------------------------------------------------
  await page.goto(`${base}/email/compose?type=CampaignMember&ids=${ids.member}`, { waitUntil: "networkidle" });
  await page.getByText("Going to 1 person").waitFor({ timeout: 20000 });
  pass("A campaign member can be emailed from the same screen");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
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
  if (ids.user) {
    const { data: batches } = await db.from("email_batch").select("id").eq("sentById", ids.user);
    const batchIds = (batches ?? []).map((b) => b.id);
    if (batchIds.length) {
      await clean("email activities", () => db.from("activity").delete().in("batchId", batchIds));
      await clean("batches", () => db.from("email_batch").delete().in("id", batchIds));
    }
    await clean("jobs", () => db.from("job").delete().eq("createdById", ids.user));
    await clean("templates", () => db.from("email_template").delete().eq("createdById", ids.user));
  }
  await clean("suppression", () => db.from("email_suppression").delete().in("email", [addr("agreed"), addr("unasked"), addr("member")]));
  await clean("touches", () => db.from("campaign_interaction").delete().in("contactId", [ids.agreed, ids.notAgreed]));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.agreed, ids.notAgreed, ids.account, ids.member, ids.campaign]));
  await clean("member", () => db.from("campaign_member").delete().eq("id", ids.member));
  await clean("campaign", () => db.from("campaign").delete().eq("id", ids.campaign));
  await clean("contacts", () => db.from("contact").delete().in("id", [ids.agreed, ids.notAgreed]));
  await clean("account", () => db.from("account").delete().eq("id", ids.account));
  if (ids.user) {
    await clean("sign-ins", () => db.from("login_event").delete().eq("userId", ids.user));
    await clean("user", () => db.from("app_user").delete().eq("id", ids.user));
    await db.auth.admin.deleteUser(ids.user).catch(() => {});
  }
  await clean("role", () => db.from("security_role").delete().eq("id", ids.role));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
