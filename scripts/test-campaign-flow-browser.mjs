// The redesigned campaign flow, in a real browser, on real records.
//
// The page sweep only opens static routes. The screens this redesign added are
// mostly dynamic - a member, a merge of two named leads, one send's scorecard -
// so they are covered here, against records created for the run and removed
// afterwards.
//
// Nothing is emailed. The send itself is exercised by the data tests; this
// checks that every screen around it renders and that the buttons lead where
// they claim to.
//
// Usage: node scripts/test-campaign-flow-browser.mjs http://localhost:3100
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
const now = () => new Date().toISOString();
const passed = [];

const pass = (what) => {
  passed.push(what);
  console.log(`  PASS  ${what}`);
};
const step = (no, title) => {
  console.log(`\n${no}  ${title}`);
  console.log("─".repeat(64));
};

const ids = {
  role: randomUUID(),
  user: null,
  campaigns: [],
  members: [],
  leads: [],
  activities: [],
  batches: [],
};

let browser;
const errors = [];

try {
  // ─────────────────────────────────────────────────────────────────────
  step("00", "A temporary administrator and some records to look at");
  // ─────────────────────────────────────────────────────────────────────

  await db.from("security_role").insert({
    id: ids.role,
    name: `Campaign flow QA ${run}`,
    permissions: ["*"],
    dataScope: "ALL",
    updatedAt: now(),
  });

  const password = randomBytes(24).toString("base64url");
  const email = `campaign-qa-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(`Create identity: ${auth.error.message}`);
  ids.user = auth.data.user.id;

  await db.from("app_user").insert({
    id: ids.user,
    fullName: `Campaign QA ${run}`,
    email,
    roleId: ids.role,
    status: "ACTIVE",
    updatedAt: now(),
  });

  const { data: campaignType } = await db
    .from("campaign_type").select("id").limit(1).maybeSingle();
  assert.ok(campaignType, "The check needs a campaign type to exist");

  const campaignId = randomUUID();
  await db.from("campaign").insert({
    id: campaignId,
    campaignNumber: `CFQ-${run}`,
    name: `QA Webinar ${run}`,
    campaignTypeId: campaignType.id,
    ownerUserId: ids.user,
    status: "ACTIVE",
    updatedAt: now(),
  });
  ids.campaigns.push(campaignId);

  const memberId = randomUUID();
  await db.from("campaign_member").insert({
    id: memberId,
    campaignId,
    firstName: "Nadia",
    lastName: `Sheikh ${run}`,
    email: `nadia.${run}@example.com`,
    phone: "+92 301 2223344",
    companyName: `Sheikh Foods ${run}`,
    jobTitle: "Procurement Lead",
    website: "https://sheikhfoods.example",
    businessType: "RETAIL",
    companySize: "MEDIUM",
    city: "Karachi",
    source: "WEBINAR",
    ownerUserId: ids.user,
    notes: "Asked for pricing.",
    updatedAt: now(),
  });
  ids.members.push(memberId);

  // Adeel, and Adeel again under his home address, for the merge screen.
  //
  // The duplicate rule refuses a second lead with his number however it is
  // written, so that is tried first and must fail. The second lead exists only
  // because it shares nothing the rule can see - which is the case the merge
  // screen is still for. His number is random per run: the rule matches on the
  // last nine digits, and a fixed one would meet the last run's leftovers.
  const adeelNumber = String(Math.floor(Math.random() * 9e8) + 1e8);
  const leadIds = [randomUUID(), randomUUID()];
  const adeel = (i, fields) => ({
    id: leadIds[i],
    leadNumber: `CFQL-${run}-${i}`,
    firstName: "Adeel",
    lastName: `Raza ${run}`,
    companyName: `Raza Traders ${run}`,
    status: "NEW",
    leadType: "SALES",
    ownerUserId: ids.user,
    campaignId,
    updatedAt: now(),
    ...fields,
  });

  const firstLead = await db.from("lead").insert(adeel(0, {
    email: `adeel.${run}@example.com`,
    phone: `+92 ${adeelNumber.slice(0, 3)} ${adeelNumber.slice(3)}`,
    jobTitle: "Owner",
  }));
  if (firstLead.error) throw new Error(`Create the first lead: ${firstLead.error.message}`);
  ids.leads.push(leadIds[0]);

  // The same number written the local way. Kept for step 03 to assert on; if
  // it wrongly succeeds, the row is still cleaned up.
  const refusedId = randomUUID();
  const sameNumber = await db.from("lead").insert({
    ...adeel(1, { phone: `0${adeelNumber}` }),
    id: refusedId,
    leadNumber: `CFQL-${run}-X`,
  });
  if (!sameNumber.error) ids.leads.push(refusedId);

  const secondLead = await db.from("lead").insert(adeel(1, {
    email: `adeel.home.${run}@example.com`,
    city: "Lahore",
  }));
  if (secondLead.error) throw new Error(`Create the second lead: ${secondLead.error.message}`);
  ids.leads.push(leadIds[1]);

  // A send with its activities, so the scorecard has something to show.
  const batchId = randomUUID();
  await db.from("email_batch").insert({
    id: batchId,
    subject: `QA introduction ${run}`,
    bodyText: "Hello {{firstName}}, a quick note.",
    audienceType: "Lead",
    sentById: ids.user,
    skippedCount: 1,
    skippedReasons: ["Somebody Without An Address: no email address"],
    updatedAt: now(),
  });
  ids.batches.push(batchId);

  for (const [i, leadId] of leadIds.entries()) {
    const activityId = randomUUID();
    await db.from("activity").insert({
      id: activityId,
      activityType: "EMAIL",
      subject: `QA introduction ${run}`,
      ownerUserId: ids.user,
      relatedEntityType: "Lead",
      relatedEntityId: leadId,
      batchId,
      toAddress: i === 0 ? `adeel.${run}@example.com` : `adeel.home.${run}@example.com`,
      sentAt: now(),
      deliveredAt: now(),
      openedAt: i === 0 ? now() : null,
      openCount: i === 0 ? 2 : 0,
      clickedAt: i === 0 ? now() : null,
      clickCount: i === 0 ? 1 : 0,
      status: "COMPLETED",
      updatedAt: now(),
    });
    ids.activities.push(activityId);
  }

  // A logged call, so the activities panel shows a non-email row too.
  const logId = randomUUID();
  await db.from("activity").insert({
    id: logId,
    activityType: "LOG",
    subject: `Called about pricing ${run}`,
    description: "Wants a quote before the end of the month.",
    outcome: "Sending a quote.",
    ownerUserId: ids.user,
    relatedEntityType: "Lead",
    relatedEntityId: leadIds[0],
    status: "COMPLETED",
    completedAt: now(),
    updatedAt: now(),
  });
  ids.activities.push(logId);

  console.log(`  ·     Campaign, member, two leads for one person, one send`);

  // ─────────────────────────────────────────────────────────────────────
  step("01", "Signing in");
  // ─────────────────────────────────────────────────────────────────────

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));

  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  pass("Signed in");

  /** Opens a page and fails loudly if it errored rather than rendered. */
  const open = async (path) => {
    const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    const status = response?.status() ?? 0;
    assert.ok(status < 400, `${path} returned ${status}`);
    const body = await page.locator("body").innerText();
    assert.ok(
      !/Application error|Internal Server Error|Unhandled Runtime/i.test(body),
      `${path} rendered an error page`,
    );
    return body;
  };

  // ─────────────────────────────────────────────────────────────────────
  step("02", "The campaign member, as a saved record");
  // ─────────────────────────────────────────────────────────────────────

  let body = await open(`/campaign-members/${memberId}`);
  assert.match(body, /Nadia/, "The member's name should be on the page");
  assert.match(body, /Procurement Lead/, "The job title should be shown");
  assert.match(body, new RegExp(`QA Webinar ${run}`), "The campaign that produced them");
  assert.match(body, /Webinar/, "And how we got them");
  assert.match(body, /Convert to lead/i, "The convert button should be there");
  assert.match(body, /Edit/, "And an Edit button, because this is a saved record");
  pass("Member reads as a record, with its campaign, source and Convert button");

  body = await open(`/campaign-members/${memberId}/edit`);
  assert.match(body, /Nadia/, "The edit form should be filled in");
  pass("The edit form is on its own route");

  // ─────────────────────────────────────────────────────────────────────
  step("03", "A second lead for the same number is refused where it is made");
  // ─────────────────────────────────────────────────────────────────────

  assert.ok(sameNumber.error, "A lead with the same number written another way must be refused");
  assert.equal(sameNumber.error.hint, "duplicate_person", "By the duplicate rule");
  assert.ok(sameNumber.error.message.includes(`CFQL-${run}-0`), "Naming the lead he already is");
  pass("0300 … against +92 300 … is caught when the lead is made, naming the lead");

  body = await open("/leads/duplicates");
  assert.match(body, /from before new duplicates were refused/i, "The screen should say what it is for now");
  assert.ok(!body.includes(`Raza ${run}`), "Two leads sharing nothing the rule knows are not flagged");
  pass("The Duplicates screen covers what predates the rule, and does not flag these two");

  // ─────────────────────────────────────────────────────────────────────
  step("04", "The merge screen");
  // ─────────────────────────────────────────────────────────────────────

  body = await open(`/leads/merge?ids=${leadIds.join(",")}`);
  assert.match(body, /Which record do you want to keep/i, "It should ask which survives");
  assert.match(body, /Most complete/i, "And suggest one");
  // The two records hold different addresses, so email is the one real
  // decision. Job title, phone and city are held by only ONE record each, which
  // is not a disagreement - the filled value is simply taken - so they belong in
  // the settled list rather than as a choice.
  assert.match(body, /1 field disagrees/, "Exactly one field genuinely disagrees");
  assert.match(body, /EMAIL/i, "And it is the email address");
  assert.match(
    body, /with nothing to choose/i,
    "The rest must be described as settled, not as agreement - a blank is not agreement",
  );
  pass("Merge asks only about the one field that disagrees, and settles the rest");

  // ─────────────────────────────────────────────────────────────────────
  step("05", "Mass email: compose");
  // ─────────────────────────────────────────────────────────────────────

  body = await open(`/leads/email?ids=${leadIds.join(",")}`);
  assert.match(body, /Going to 2 people/i, "Two different addresses are two recipients");
  pass("Compose counts each address it will send to before anything is typed");

  // ─────────────────────────────────────────────────────────────────────
  step("06", "The scorecards");
  // ─────────────────────────────────────────────────────────────────────

  body = await open("/leads/email/sends");
  assert.match(body, new RegExp(`QA introduction ${run}`), "The send should be listed");
  pass("Every send is listed with its rates");

  body = await open(`/leads/email/sends/${batchId}`);
  assert.match(body, /Clicked/, "Clicks should be shown");
  assert.match(body, /Read the open rate carefully/i, "With the caveat about opens");
  assert.match(body, new RegExp(`Adeel`), "And who got it");
  assert.match(body, /Left out of this send/i, "Plus who was skipped");
  pass("One send's scorecard shows clicks, opens, recipients and who was skipped");

  // ─────────────────────────────────────────────────────────────────────
  step("07", "Activities on the lead");
  // ─────────────────────────────────────────────────────────────────────

  body = await open(`/leads/${leadIds[0]}`);
  assert.match(body, /Activities/, "The lead should have an activities panel");
  assert.match(body, new RegExp(`QA introduction ${run}`), "Showing the email that was sent");
  assert.match(body, new RegExp(`Called about pricing ${run}`), "And the logged call");
  assert.match(body, /1 click/i, "With what the recipient did");
  assert.match(body, /Log something/i, "And a way to add more");
  pass("Emails and logged calls both appear on the lead, with click counts");

  // ─────────────────────────────────────────────────────────────────────
  step("08", "The campaign's own email figures");
  // ─────────────────────────────────────────────────────────────────────

  body = await open(`/campaigns/${campaignId}`);
  assert.match(body, /Email to these leads/i, "The campaign should roll up its email");
  assert.ok(
    !/Activities \(/.test(body),
    "The old campaign-activities card should be gone",
  );
  pass("Campaign shows email rolled up through its leads, and the old card is gone");

  // ─────────────────────────────────────────────────────────────────────
  step("09", "The campaign filter on the leads list");
  // ─────────────────────────────────────────────────────────────────────

  body = await open(`/leads?campaignId=${campaignId}`);
  assert.match(body, new RegExp(`Raza ${run}`), "Leads from the campaign should be listed");
  assert.match(body, /All campaigns/, "And the filter itself should be on the page");
  pass("Leads can be narrowed to one campaign - how a campaign audience is chosen");

  // ─────────────────────────────────────────────────────────────────────
  step("10", "Nothing threw in the browser");
  // ─────────────────────────────────────────────────────────────────────

  assert.equal(
    errors.length,
    0,
    `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`,
  );
  pass("No runtime errors on any of these pages");

  console.log(`\n${"═".repeat(64)}`);
  console.log(`${passed.length} checks passed.`);
  console.log(`${"═".repeat(64)}\n`);
} finally {
  if (browser) await browser.close().catch(() => {});

  const del = async (table, column, values) => {
    if (!values.length) return;
    const r = await db.from(table).delete().in(column, values);
    if (r.error) console.error(`  teardown ${table}: ${r.error.message}`);
  };

  await del("activity", "id", ids.activities);
  await del("email_batch", "id", ids.batches);
  await del("campaign_member", "id", ids.members);
  await del("lead", "id", ids.leads);
  await del("campaign", "id", ids.campaigns);
  if (ids.user) {
    await db.from("app_user").delete().eq("id", ids.user);
    await db.auth.admin.deleteUser(ids.user).catch(() => {});
  }
  await db.from("security_role").delete().eq("id", ids.role);
  console.log("Temporary data removed.");
}
