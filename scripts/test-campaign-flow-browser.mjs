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

  // Two leads that look like one person, for the merge screen.
  const leadIds = [randomUUID(), randomUUID()];
  for (const [i, id] of leadIds.entries()) {
    await db.from("lead").insert({
      id,
      leadNumber: `CFQL-${run}-${i}`,
      firstName: "Adeel",
      lastName: `Raza ${run}`,
      companyName: `Raza Traders ${run}`,
      // Same number, written two ways - which is what the matcher must see through.
      phone: i === 0 ? "+92 300 9876543" : "03009876543",
      email: `adeel.${run}@example.com`,
      jobTitle: i === 0 ? "Owner" : null,
      city: i === 0 ? null : "Lahore",
      status: "NEW",
      leadType: "SALES",
      ownerUserId: ids.user,
      campaignId,
      updatedAt: now(),
    });
    ids.leads.push(id);
  }

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
      toAddress: `adeel.${run}@example.com`,
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

  console.log(`  ·     Campaign, member, two duplicate leads, one send`);

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
  step("03", "Duplicates, found on a number written two ways");
  // ─────────────────────────────────────────────────────────────────────

  body = await open("/leads/duplicates");
  assert.match(body, new RegExp(`Raza ${run}`), "The duplicate pair should be listed");
  assert.match(body, /Merge these/i, "With a way to merge them");
  pass("Both leads flagged - matched despite +92 300 … against 0300 …");

  // ─────────────────────────────────────────────────────────────────────
  step("04", "The merge screen");
  // ─────────────────────────────────────────────────────────────────────

  body = await open(`/leads/merge?ids=${leadIds.join(",")}`);
  assert.match(body, /Which record do you want to keep/i, "It should ask which survives");
  assert.match(body, /Most complete/i, "And suggest one");
  // The two records hold the same number written differently, so phone is the
  // one real decision. Job title and city are held by only ONE record each,
  // which is not a disagreement - the filled value is simply taken - so they
  // belong in the settled list rather than as a choice.
  assert.match(body, /1 field disagrees/, "Exactly one field genuinely disagrees");
  assert.match(body, /PHONE/i, "And it is the phone number");
  assert.match(
    body, /with nothing to choose/i,
    "The rest must be described as settled, not as agreement - a blank is not agreement",
  );
  pass("Merge asks only about the one field that disagrees, and settles the rest");

  // ─────────────────────────────────────────────────────────────────────
  step("05", "Mass email: compose");
  // ─────────────────────────────────────────────────────────────────────

  body = await open(`/leads/email?ids=${leadIds.join(",")}`);
  assert.match(body, /Going to 1 person/i, "The duplicate address must collapse to one recipient");
  assert.match(body, /will be left out/i, "And it must say somebody is being left out");
  pass("Compose collapses the duplicate address and says so before anything is typed");

  await page.locator("button", { hasText: "See who" }).click();
  await page.waitForTimeout(400);
  body = await page.locator("body").innerText();
  assert.match(body, /Duplicate of another selected lead/i, "The reason should be named");
  pass("The audience list names why each person is in or out");

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
