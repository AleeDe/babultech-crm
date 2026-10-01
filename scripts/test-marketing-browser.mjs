// Marketing: website forms, prospects, source tracking, campaign touches,
// scoring, deal attribution, referrals and the dashboard - in a real browser
// and against the public form endpoint.
//
// A temporary marketer makes a website form on a temporary campaign. The form
// is posted as a website would post it: a new visitor becomes a Prospect
// carrying where they first and last came from; the same person again is a
// touch, not a second lead; robots and incomplete forms are refused. The
// marketer then qualifies the prospect, logs a touch, names a referrer, and
// sees the funnel, the attribution on the resulting deal and the dashboard.
//
// No email is sent: every address is example.com. Everything created is
// removed afterwards.
//
// Usage: node scripts/test-marketing-browser.mjs http://localhost:3100
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
  role: randomUUID(), user: null, campaign: randomUUID(), account: randomUUID(), contact: randomUUID(), deal: randomUUID(),
  form: null, lead: null,
};
const visitor = `visitor-${lower}@example.com`;
let browser;

async function post(key, body, { json = true, origin = "https://example.com" } = {}) {
  const res = await fetch(`${base}/api/forms/${key}`, {
    method: "POST",
    headers: json ? { "Content-Type": "application/json", Origin: origin } : { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
    body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
    redirect: "manual",
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* HTML */ }
  return { status: res.status, body: parsed, text };
}

try {
  await must(db.from("security_role").insert({
    id: ids.role, name: `QA Marketing ${run}`,
    permissions: ["lead:read", "lead:write", "account:read", "account:write", "opportunity:read"], dataScope: "ALL", updatedAt: now(),
  }), "Create the role");
  const email = `marketing-qa-${lower}@example.com`;
  const password = randomBytes(24).toString("base64url");
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({
    id: ids.user, fullName: `QA Marketing ${run}`, email, roleId: ids.role, status: "ACTIVE", updatedAt: now(),
  }), "Create the user");
  const type = await must(db.from("campaign_type").select("id").limit(1).single(), "A campaign type");
  await must(db.from("campaign").insert({
    id: ids.campaign, campaignNumber: `QA-MK-${run}`, name: `QA Launch ${run}`, campaignTypeId: type.id,
    ownerUserId: ids.user, status: "ACTIVE", actualCost: 1000, updatedAt: now(),
  }), "Create the campaign");
  await must(db.from("account").insert({
    id: ids.account, accountNumber: `QA-MK-A-${run}`, name: `QA Referrer Co ${run}`, accountType: "CUSTOMER", ownerUserId: ids.user, updatedAt: now(),
  }), "Create an account");
  await must(db.from("contact").insert({
    id: ids.contact, accountId: ids.account, firstName: "Refa", lastName: `Rer ${run}`, email: `referrer-${lower}@example.com`, updatedAt: now(),
  }), "Create a contact who refers people");
  pass("A marketer, a campaign and a contact to refer people");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  page.on("dialog", (d) => { if (process.env.QA_TRACE) console.log("ALERT", d.message()); d.accept(); });
  if (process.env.QA_TRACE) page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log("CONSOLE", m.type(), m.text().slice(0, 300)); });
  if (process.env.QA_TRACE) {
    const t0 = new Map();
    page.on("request", (q) => { t0.set(q, Date.now()); if (true) console.log(q.method() + ">", q.url().slice(0, 100), q.headers()["next-action"]?.slice(0, 12) ?? ""); });
    page.on("requestfinished", (q) => { const ms = Date.now() - (t0.get(q) ?? Date.now()); if (ms > 1500) console.log("SLOW", ms, q.method(), q.url().slice(0, 120), q.headers()["next-action"] ? "action" : ""); });
    page.on("requestfailed", (q) => console.log("FAILED", q.method(), q.url().slice(0, 120), q.failure()?.errorText));
    page.on("framenavigated", (fr) => { if (fr === page.mainFrame()) console.log("NAV", fr.url().slice(0, 100)); });
  }
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  // --- A website form -------------------------------------------------------
  await page.goto(`${base}/campaigns/${ids.campaign}`, { waitUntil: "networkidle" });
  await page.getByText("Website forms").first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "New form" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill(`QA contact form ${run}`);
  await page.getByRole("button", { name: "Create form" }).click();
  await page.waitForURL(/\/campaigns\/forms\/[0-9a-f-]{36}/, { timeout: 20000 });
  await page.getByText("Put it on your website").waitFor({ timeout: 20000 });
  const form = await must(db.from("web_form").select("id, formKey").eq("campaignId", ids.campaign).single(), "Read the form");
  ids.form = form.id;
  const code = await page.locator("pre").innerText();
  assert.ok(code.includes(`/api/forms/${form.formKey}`) && code.includes("_gotcha") && code.includes("/api/forms/script"), "The embed code posts to the form, with the spam trap and script");
  pass("A website form is made from the campaign, with code to paste into the site");

  // --- Posting it as a website would ---------------------------------------
  let r = await post(form.formKey, {
    firstName: "Vee", lastName: `Sitor ${run}`, email: visitor, companyName: `QA Visitor Co ${run}`, jobTitle: "Operations Director", message: "Tell me more",
    _touch: {
      first: { utmSource: "google", utmMedium: "cpc", utmCampaign: "launch", landingPage: "https://example.com/pricing", at: "2026-09-01T09:00:00Z" },
      latest: { utmSource: "linkedin", utmMedium: "social", landingPage: "https://example.com/contact" },
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.ok, true);
  const lead = await must(db.from("lead").select("id, status, ownerUserId, campaignId, firstSource, firstMedium, firstLandingPage, latestSource, utmSource, firstTouchAt").eq("email", visitor).single(), "Read the new lead");
  ids.lead = lead.id;
  assert.equal(lead.status, "PROSPECT");
  assert.equal(lead.ownerUserId, ids.user, "Owned by the campaign's owner");
  assert.equal(lead.campaignId, ids.campaign);
  assert.deepEqual([lead.firstSource, lead.firstMedium, lead.firstLandingPage, lead.latestSource, lead.utmSource],
    ["google", "cpc", "https://example.com/pricing", "linkedin", "linkedin"]);
  assert.ok(lead.firstTouchAt.startsWith("2026-09-01"), "The first visit's date, not today's");
  pass("A new visitor becomes a Prospect with their first and latest touch");

  r = await post(form.formKey, { firstName: "Vee", email: visitor.toUpperCase(), _touch: { latest: { utmSource: "newsletter" } } });
  assert.equal(r.status, 200);
  const leads = await must(db.from("lead").select("id, latestSource").ilike("email", visitor), "Read leads");
  assert.equal(leads.length, 1, "Not a second lead");
  assert.equal(leads[0].latestSource, "newsletter", "The latest touch moved");
  pass("The same person again is a touch on their lead, not a duplicate");

  r = await post(form.formKey, { firstName: "Robo", email: `robot-${lower}@example.com`, _gotcha: "http://spam" });
  assert.equal(r.status, 200, "A robot is told it worked");
  assert.equal((await db.from("lead").select("id").eq("email", `robot-${lower}@example.com`)).data.length, 0, "But no lead is made");
  r = await post(form.formKey, { lastName: "No first name", email: `half-${lower}@example.com` });
  assert.equal(r.status, 400, "A required field missing is refused");
  r = await post(form.formKey, { firstName: "Plain", email: `plain-${lower}@example.com` }, { json: false });
  assert.equal(r.status, 200);
  assert.match(r.text, /Thank you/, "A plain HTML post gets a thank-you page");
  const subs = await must(db.from("web_form_submission").select("outcome").eq("formId", ids.form), "Submissions");
  assert.deepEqual(subs.map((s) => s.outcome).sort(), ["CREATED", "CREATED", "INVALID", "MATCHED_LEAD", "SPAM"]);
  pass("Robots and incomplete forms are refused, a plain HTML form still works, and every submission is kept");

  await page.goto(`${base}/campaigns/forms/${ids.form}`, { waitUntil: "networkidle" });
  const subsText = await page.locator("table").last().innerText();
  assert.match(subsText, /New prospect/);
  assert.match(subsText, /Spam/);
  pass("The form's page lists its submissions and what became of each");

  // --- Prospects in the lead list ------------------------------------------
  await page.goto(`${base}/leads?all=1`, { waitUntil: "networkidle" });
  assert.ok(!(await page.locator("body").innerText()).includes(`Sitor ${run}`), "Prospects are not in the lead list");
  await page.goto(`${base}/leads?status=PROSPECT`, { waitUntil: "networkidle" });
  await page.getByText(`Sitor ${run}`).first().waitFor({ timeout: 15000 });
  pass("Prospects stay out of the lead list until asked for");

  // --- The prospect's page ---------------------------------------------------
  await page.goto(`${base}/leads/${ids.lead}`, { waitUntil: "networkidle" });
  await page.getByText("Where they came from").waitFor({ timeout: 20000 });
  let body = await page.locator("body").innerText();
  assert.match(body, /google \/ cpc/);
  assert.match(body, /linkedin|newsletter/);
  assert.match(body, /Submitted a website form/);
  pass("The lead shows where they came from and their campaign touches");

  await page.getByRole("button", { name: "Qualify to lead" }).click();
  await page.getByRole("button", { name: "Qualify to lead" }).waitFor({ state: "detached", timeout: 60000 }).catch(async (e) => { console.log("STATUS NOW:", (await db.from("lead").select("status").eq("id", ids.lead).single()).data, "ERRORS:", JSON.stringify(errors).slice(0, 1500)); throw e; });
  assert.equal((await must(db.from("lead").select("status").eq("id", ids.lead).single(), "Status")).status, "NEW");
  pass("Qualify to lead moves the prospect to New");

  if (process.env.QA_TRACE) {
    const probe = await page.evaluate(async (u) => {
      const t = Date.now();
      try {
        const r = await fetch(u, { headers: { RSC: "1" } });
        const text = await r.text();
        return { status: r.status, ms: Date.now() - t, len: text.length, tail: text.slice(-400) };
      } catch (e) { return { error: String(e), ms: Date.now() - t }; }
    }, `/leads/${ids.lead}`);
    console.log("PROBE", JSON.stringify(probe));
  }
  await page.getByRole("button", { name: "Log a touch" }).click();
  await page.getByRole("dialog").locator('select[name="interactionType"]').selectOption("EVENT_ATTENDED");
  await page.getByRole("dialog").locator('textarea[name="details"]').fill(`QA expo ${run}`);
  await page.getByRole("button", { name: "Log touch" }).click();
  await page.getByText(`QA expo ${run}`).first().waitFor({ timeout: 15000 }).catch(async (e) => {
    console.log("DIALOG:", await page.getByRole("dialog").innerText().catch(() => "closed"));
    console.log("TOUCHES:", JSON.stringify((await db.from("campaign_interaction").select("interactionType, details").eq("leadId", ids.lead)).data));
    throw e;
  });
  const touches = await must(db.from("campaign_interaction").select("interactionType, createdById").eq("leadId", ids.lead), "Touches");
  assert.equal(touches.length, 3);
  assert.ok(touches.some((t) => t.interactionType === "EVENT_ATTENDED" && t.createdById === ids.user));
  pass("A touch logged by hand is saved in the marketer's name");

  const scored = await must(db.from("lead").select("score").eq("id", ids.lead).single(), "Score");
  // Two forms (20 each), an event (15) and "Director" in the job title (10).
  assert.equal(scored.score, 65, `Score ${scored.score}`);
  pass("The score adds up the touches and the job title: 65");

  await page.getByRole("button", { name: "Add", exact: true }).first().click();
  await page.getByLabel("Referring contact").fill(`Rer ${run}`);
  await page.getByRole("button", { name: new RegExp(`Refa Rer ${run}`) }).click();
  await page.getByRole("link", { name: `Refa Rer ${run}` }).waitFor({ timeout: 15000 }).catch(async (e) => {
    console.log("REFERRAL:", JSON.stringify((await db.from("lead").select("referredByContactId, leadSource").eq("id", ids.lead).single()).data));
    throw e;
  });
  const referred = await must(db.from("lead").select("referredByContactId, leadSource").eq("id", ids.lead).single(), "Referral");
  assert.deepEqual(referred, { referredByContactId: ids.contact, leadSource: "Referral" });
  await page.goto(`${base}/leads/referrals`, { waitUntil: "networkidle" });
  await page.getByText(`Refa Rer ${run}`).waitFor({ timeout: 15000 });
  pass("A referring contact is named on the lead and counted on the referrals page");

  // --- Conversion carries the campaigns to the deal ----------------------------
  await must(db.from("opportunity").insert({
    id: ids.deal, opportunityNumber: `QA-MK-D-${run}`, name: `QA Visitor deal ${run}`, accountId: ids.account, ownerUserId: ids.user,
    campaignId: ids.campaign, stage: "DISCOVERY", amount: 5000, currencyCode: "PKR", expectedCloseDate: now().slice(0, 10), updatedAt: now(),
  }), "Create the deal");
  await must(db.from("lead").update({ convertedOpportunityId: ids.deal, convertedContactId: ids.contact }).eq("id", ids.lead), "Link the conversion");
  const roles = await must(db.from("opportunity_campaign").select("role").eq("opportunityId", ids.deal), "Attribution");
  assert.deepEqual(roles.map((x) => x.role).sort(), ["FIRST", "LATEST", "LEAD_CREATION"]);
  await page.goto(`${base}/opportunities/${ids.deal}`, { waitUntil: "networkidle" });
  await page.getByText("Campaign attribution").waitFor({ timeout: 20000 });
  const card = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h3, h2, div")].find((el) => el.textContent?.trim() === "Campaign attribution");
    let el = heading;
    while (el && !el.textContent?.includes("Latest touch")) el = el.parentElement;
    return el?.textContent ?? "";
  });
  assert.equal((card.match(new RegExp(`QA Launch ${run}`, "g")) ?? []).length, 4, "All four roles credit the campaign");
  pass("Converting carries first, lead-creation and latest campaigns to the deal");

  // --- The campaign and the dashboard -----------------------------------------
  await page.goto(`${base}/campaigns/${ids.campaign}`, { waitUntil: "networkidle" });
  await page.getByText("Funnel and return").waitFor({ timeout: 20000 });
  body = await page.locator("body").innerText();
  assert.match(body, /Prospects & leads\s*\n?\s*2/, "Two leads came from the form");
  assert.match(body, /Latest touches/);
  pass("The campaign shows its funnel, return and latest touches");

  await page.goto(`${base}/campaigns/dashboard`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: `QA Launch ${run}` }).waitFor({ timeout: 20000 });
  pass("The marketing dashboard lists the campaign");

  await page.goto(`${base}/campaigns/scoring`, { waitUntil: "networkidle" });
  await page.getByText("Submitted a website form").first().waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole("button", { name: "Add a rule" }).count(), 0, "Only administrators change the rules");
  pass("Lead scoring rules are listed, read-only for a non-administrator");

  const script = await fetch(`${base}/api/forms/script`);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);
  assert.match(await script.text(), /data-babultech-form/);
  pass("The embed script is served");

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
  const madeLeads = (await db.from("lead").select("id").or(`email.ilike.%-${lower}@example.com`)).data?.map((l) => l.id) ?? [];
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [...madeLeads, ids.deal, ids.contact, ids.account, ids.campaign]));
  await clean("deal", () => db.from("opportunity").delete().eq("id", ids.deal));
  if (madeLeads.length) await clean("leads", () => db.from("lead").delete().in("id", madeLeads));
  await clean("contact", () => db.from("contact").delete().eq("id", ids.contact));
  await clean("account", () => db.from("account").delete().eq("id", ids.account));
  await clean("campaign", () => db.from("campaign").delete().eq("id", ids.campaign));
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
