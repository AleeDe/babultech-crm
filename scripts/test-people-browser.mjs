// People: hiring, signing, logins, renewals and leaving - in a real browser.
//
// An administrator hires an intern through the wizard; the intern signs
// through the public link; someone with only the People permissions signs for
// the company; the administrator creates the login. Then a renewal is signed
// by hand and starts, the person resigns, and the daily job switches their
// login off. Dates are moved in the database to stand in for months passing.
// Team parts, combining roles, templates and who may see what are checked on
// the way. Everything created is removed; no email is sent (example.com, and
// the signing link is copied rather than emailed).
//
// Usage: node scripts/test-people-browser.mjs http://localhost:3100
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname)) throw new Error("This check only targets the local application.");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what) {
  for (let i = 0; i < 40; i++) {
    const v = await fn();
    if (v) return v;
    await wait(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}
const karachiToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const ids = {
  adminRole: randomUUID(), hrRole: randomUUID(), plainRole: randomUUID(), team: randomUUID(),
  admin: null, hr: null, manager: null, plain: null, hire: null, staff: null, contracts: [], template: null, combinedRole: null,
};
let browser;

async function makeLogin(name, roleId) {
  const email = `ppl-${name}-${lower}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  await must(db.from("app_user").insert({ id: auth.data.user.id, fullName: `QA ${name} ${run}`, email, roleId, status: "ACTIVE", updatedAt: now() }), `Login ${name}`);
  return { id: auth.data.user.id, email, password };
}
async function signedIn(login) {
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(login.email);
  await page.locator('input[name="password"]').fill(login.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });
  return page;
}
async function draw(page, selector = "[data-signature-pad]") {
  const pad = page.locator(selector).first();
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height * 0.6);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 30 + i * 20, box.y + box.height * (i % 2 ? 0.35 : 0.65));
  await page.mouse.up();
}
const contract = async (id) => (await db.from("employment_contract").select("*").eq("id", id).single()).data;
const tick = async () => must(db.rpc("people_contract_tick"), "Daily job");

try {
  await must(db.from("security_role").insert([
    { id: ids.adminRole, name: `QA People Admin ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() },
    { id: ids.hrRole, name: `QA People HR ${run}`, permissions: ["people:read", "people:write"], dataScope: "OWN", updatedAt: now() },
    { id: ids.plainRole, name: `QA People Plain ${run}`, permissions: ["project:read"], dataScope: "OWN", updatedAt: now() },
  ]), "Roles");
  const admin = await makeLogin("admin", ids.adminRole);
  const hr = await makeLogin("hr", ids.hrRole);
  const manager = await makeLogin("manager", ids.plainRole);
  const plain = await makeLogin("plain", ids.plainRole);
  Object.assign(ids, { admin: admin.id, hr: hr.id, manager: manager.id, plain: plain.id });
  await must(db.from("team").insert({ id: ids.team, name: `QA Team ${run}`, teamType: "QA", active: true, updatedAt: now() }), "Team");
  const marketing = await must(db.from("security_role").select("id").eq("name", "Marketing").single(), "Marketing role");
  pass("An administrator, an HR person, a manager, a colleague without access, and a QA team");

  browser = await chromium.launch({ headless: true });
  const adm = await signedIn(admin);

  // --- The wizard ---------------------------------------------------------
  const name = `QA Hire ${run}`;
  await adm.goto(`${base}/people`, { waitUntil: "networkidle" });
  await adm.getByRole("link", { name: "Hire someone" }).first().click();
  await adm.waitForURL(/\/people\/new/);
  await adm.locator('input[name="fullName"]').fill(name);
  await adm.locator('input[name="fatherName"]').fill("QA Father");
  await adm.locator('input[name="nationalId"]').fill("35202-0000000-1");
  await adm.locator('input[name="personalEmail"]').fill(`ppl-hire-${lower}@example.com`);
  await adm.locator('input[name="linkedinUrl"]').fill("https://www.linkedin.com/in/qa-hire");
  await adm.locator('input[name="githubUrl"]').fill("https://github.com/qa-hire");
  await adm.getByRole("button", { name: "Next" }).click();
  await adm.getByRole("button", { name: "Add education" }).click();
  await adm.locator('input[name="education.0.degree"]').fill("BS Computer Science");
  await adm.locator('input[name="education.0.institution"]').fill("QA University");
  await adm.getByRole("button", { name: "Add experience" }).click();
  await adm.locator('input[name="experience.0.company"]').fill("QA Previous Co");
  await adm.locator('input[name="experience.0.title"]').fill("Junior");
  await adm.locator('input[name="skill"]').fill("SEO, Copywriting");
  await adm.getByRole("button", { name: "Add", exact: true }).click();
  await adm.getByRole("button", { name: "Next" }).click();
  // Three months is the default; the end date follows the start date.
  const start = karachiToday();
  await adm.locator('input[name="startDate"]').fill(start);
  const endShown = await adm.locator('input[name="endDate"]').inputValue();
  await adm.locator('input[name="jobTitle"]').fill("Marketing Intern");
  await adm.locator('select[name="reportsToUserId"]').selectOption(manager.id);
  await adm.locator('select[name="roleId"]').selectOption(marketing.id);
  await adm.locator(`input[name="teamIds"][value="${ids.team}"]`).check();
  await adm.getByRole("button", { name: "Next" }).click();
  await adm.locator('input[name="benefits"][value="Training"]').check();
  await adm.locator('input[name="benefits"][value="Weekly lunch"]').check();
  await adm.locator('input[name="extraBenefit"]').fill(`Laptop ${run}`);
  await adm.locator('input[name="extraBenefit"]').press("Enter");
  await adm.locator('select[name="payBasis"]').selectOption("MONTHLY");
  await adm.locator('input[name="payAmount"]').fill("52000");
  await adm.locator('select[name="currencyCode"]').selectOption("PKR");
  await adm.getByRole("button", { name: "Next" }).click();
  await adm.getByText("PKR 52,000 per month").waitFor();
  await adm.getByRole("button", { name: "Save and prepare contract" }).click();
  await adm.waitForURL(/\/people\/contracts\/[0-9a-f-]{36}/, { timeout: 30000 });
  const staff = await until(async () => (await db.from("staff_profile").select("*").eq("fullName", name).maybeSingle()).data, "profile");
  ids.staff = staff.id;
  const first = (await db.from("employment_contract").select("*").eq("staffId", staff.id).single()).data;
  ids.contracts.push(first.id);
  assert.equal(staff.linkedinUrl, "https://www.linkedin.com/in/qa-hire");
  assert.equal(staff.education[0].degree, "BS Computer Science");
  assert.deepEqual(staff.skills, ["SEO", "Copywriting"]);
  assert.equal(first.status, "DRAFT");
  assert.equal(first.contractType, "INTERNSHIP");
  assert.equal(first.tenureMonths, 3);
  assert.equal(first.endDate, endShown, "The end date saved is the one shown");
  assert.equal(first.reportsToUserId, manager.id);
  assert.deepEqual(first.teamIds, [ids.team]);
  assert.ok(first.benefits.includes(`Laptop ${run}`) && first.benefits.includes("Training"));
  assert.equal(Number(first.payAmount), 52000);
  assert.ok(first.body.includes(name) && first.body.includes("35202-0000000-1") && first.body.includes("PKR 52,000 per month"), "The template is filled in");
  pass("The wizard saves the profile and a draft contract filled in from the template");

  // --- Wording, link, public signing --------------------------------------
  await adm.locator('textarea[name="contractBody"]').fill(`${first.body}\nQA extra clause ${run}`);
  await adm.getByRole("button", { name: "Save wording" }).click();
  await until(async () => (await contract(first.id)).body.includes(`QA extra clause ${run}`), "wording saved");
  await adm.reload({ waitUntil: "networkidle" });
  await adm.getByRole("button", { name: "Get signing link" }).click();
  const link = await (await adm.locator('input[name="signingLink"]').waitFor().then(() => adm.locator('input[name="signingLink"]'))).inputValue();
  assert.match(link, /\/sign\/[A-Za-z0-9_-]{40,}$/);
  assert.equal((await contract(first.id)).status, "SENT");
  pass("The wording can be changed while a draft, and a signing link is issued once");

  const publicPage = await (await browser.newContext()).newPage();
  publicPage.on("pageerror", (e) => errors.push({ url: publicPage.url(), message: e.message }));
  await publicPage.goto(`${base}/sign/not-a-real-token-${run}-xxxxxxxxxxxxxxxx`);
  await publicPage.getByText("This signing link is not valid").waitFor();
  await publicPage.goto(link.replace(/^https?:\/\/[^/]+/, base));
  await publicPage.getByText(`QA extra clause ${run}`).waitFor();
  assert.equal(await publicPage.getByRole("button", { name: "Sign the contract" }).isDisabled(), true, "Cannot sign without a signature");
  await draw(publicPage);
  await publicPage.locator('input[name="agree"]').check();
  await publicPage.getByRole("button", { name: "Sign the contract" }).click();
  await publicPage.getByText("You signed this contract").waitFor({ timeout: 30000 });
  const afterEmployee = await contract(first.id);
  assert.equal(afterEmployee.status, "EMPLOYEE_SIGNED");
  assert.match(afterEmployee.employeeSignature, /^data:image\/png;base64,/);
  assert.equal(afterEmployee.employeeSignedName, name);
  pass("The hire reads and signs through the link, without a login; a made-up link is refused");

  // --- The company signs: someone with only the People permissions ---------
  const hrPage = await signedIn(hr);
  await until(async () => (await db.from("notification").select("id").eq("userId", hr.id).eq("kind", "CONTRACT_SIGNED")).data?.length, "signed notification");
  await hrPage.goto(`${base}/people/contracts/${first.id}`, { waitUntil: "networkidle" });
  await hrPage.locator('input[name="companySignerName"]').fill(`QA HR ${run}`);
  await draw(hrPage);
  await hrPage.getByRole("button", { name: "Sign for the company" }).click();
  await until(async () => (await contract(first.id)).status === "ACTIVE", "contract active");
  pass("Whoever manages contracts is told, signs for the company, and a contract starting today starts");

  await hrPage.goto(`${base}/people/${staff.id}`, { waitUntil: "networkidle" });
  await hrPage.getByText("An administrator creates it from this page").waitFor();
  await hrPage.goto(`${base}/users`, { waitUntil: "networkidle" });
  pass("Someone who manages contracts cannot create logins");

  // --- The login -----------------------------------------------------------
  const hireLogin = { email: `ppl-hire-login-${lower}@example.com`, password: `Pw-${randomBytes(9).toString("base64url")}7Q` };
  await adm.goto(`${base}/people/${staff.id}`, { waitUntil: "networkidle" });
  await adm.getByRole("button", { name: "Create login" }).click();
  await adm.locator('input[name="loginEmail"]').fill(hireLogin.email);
  await adm.locator('input[name="loginPassword"]').fill(hireLogin.password);
  await adm.getByRole("button", { name: "Create login" }).click();
  const user = await until(async () => (await db.from("app_user").select("*").eq("email", hireLogin.email).maybeSingle()).data, "login");
  ids.hire = user.id;
  assert.equal(user.roleId, marketing.id);
  assert.equal(user.jobTitle, "Marketing Intern");
  assert.equal(user.managerUserId, manager.id);
  assert.equal(user.status, "ACTIVE");
  assert.equal(Number(user.costRate), 300, "52,000 a month at 40 hours a week is 300 an hour");
  assert.equal((await db.from("staff_profile").select("userId").eq("id", staff.id).single()).data.userId, user.id);
  assert.equal((await db.from("team_member").select("id").eq("userId", user.id).eq("teamId", ids.team)).data.length, 1);
  pass("The login takes its role, title, manager, team and hourly cost from the contract");

  // The hire sees their own contract, and nothing else of People.
  const hirePage = await signedIn({ email: hireLogin.email, password: hireLogin.password });
  await hirePage.goto(`${base}/profile`, { waitUntil: "networkidle" });
  await hirePage.getByRole("link", { name: /Internship · Marketing Intern/ }).click();
  await hirePage.waitForURL(/\/people\/contracts\//);
  await hirePage.getByText(`QA extra clause ${run}`).waitFor();
  assert.equal(await hirePage.getByRole("heading", { name: "Next step" }).count(), 0, "No actions on their own contract");
  await hirePage.goto(`${base}/people`, { waitUntil: "networkidle" });
  await hirePage.getByText("You do not have access", { exact: false }).first().waitFor();
  const plainPage = await signedIn(plain);
  await plainPage.goto(`${base}/people/contracts/${first.id}`, { waitUntil: "networkidle" });
  assert.equal(await plainPage.getByText(`QA extra clause ${run}`).count(), 0, "A colleague cannot open someone's contract");
  pass("The hire sees their own contract under My account; colleagues see none");

  await adm.goto(`${base}/print/contracts/${first.id}`, { waitUntil: "networkidle" });
  await adm.getByRole("button", { name: "Print or save as PDF" }).waitFor();
  assert.equal(await adm.locator("img").count(), 2, "Both signatures on the printout");
  pass("The printout carries the text and both signatures");

  // --- Renewal, signed by hand, starting when the first ends ---------------
  await adm.goto(`${base}/people/contracts/${first.id}`, { waitUntil: "networkidle" });
  await adm.getByRole("link", { name: "Renew", exact: true }).click();
  await adm.waitForURL(/contracts\/new\?from=/);
  assert.equal(await adm.locator('input[name="startDate"]').inputValue(), addDays(first.endDate, 1), "A renewal starts the day after");
  await adm.locator('input[name="payAmount"]').fill("60000");
  await adm.getByRole("button", { name: "Prepare contract" }).click();
  await adm.waitForURL(/\/people\/contracts\/[0-9a-f-]{36}$/, { timeout: 30000 });
  const renewal = (await db.from("employment_contract").select("*").eq("previousContractId", first.id).single()).data;
  ids.contracts.push(renewal.id);
  await adm.getByRole("button", { name: "Signed on paper instead?" }).click();
  await adm.getByRole("button", { name: "Mark as signed" }).click();
  await until(async () => (await contract(renewal.id)).status === "SIGNED", "renewal signed");
  assert.equal((await contract(first.id)).status, "ACTIVE", "The first still runs until its end");
  pass("A renewal is prepared from the contract, signed by hand, and waits for its start date");

  // Months pass: the first contract ends yesterday, the renewal starts today.
  await must(db.from("employment_contract").update({ startDate: addDays(start, -90), endDate: addDays(start, -1) }).eq("id", first.id), "Shift first");
  await must(db.from("employment_contract").update({ startDate: start, endDate: addDays(start, 10), jobTitle: "Marketing Associate" }).eq("id", renewal.id), "Shift renewal");
  await tick();
  assert.equal((await contract(first.id)).status, "RENEWED");
  assert.equal((await contract(renewal.id)).status, "ACTIVE");
  const synced = (await db.from("app_user").select("jobTitle, costRate, status").eq("id", user.id).single()).data;
  assert.equal(synced.jobTitle, "Marketing Associate");
  assert.equal(Number(synced.costRate), 346.15, "The new pay sets the hourly cost");
  pass("When the renewal starts, the first is marked renewed and the login follows the new terms");

  const ending = await until(async () => (await db.from("notification").select("dedupeKey").eq("userId", hr.id).eq("kind", "CONTRACT_ENDING")).data?.[0], "ending reminder");
  assert.equal(ending.dedupeKey, `contract-ending:${renewal.id}:14`);
  assert.ok((await db.from("notification").select("id").eq("userId", manager.id).eq("kind", "CONTRACT_ENDING")).data.length, "Their manager is told too");
  pass("A contract ending within 30 days reminds whoever manages contracts and the person's manager");

  // --- Resignation, then the login goes off --------------------------------
  await adm.goto(`${base}/people/contracts/${renewal.id}`, { waitUntil: "networkidle" });
  await adm.getByRole("button", { name: "Terminate, or record a resignation" }).click();
  await adm.locator('select[name="endKind"]').selectOption("RESIGNED");
  await adm.locator('input[name="lastWorkingDay"]').fill(start);
  await adm.locator('textarea[name="endReason"]').fill(`QA moving on ${run}`);
  await adm.getByRole("button", { name: "Record it" }).click();
  await until(async () => (await contract(renewal.id)).status === "RESIGNED", "resigned");
  assert.equal((await db.from("app_user").select("status").eq("id", user.id).single()).data.status, "ACTIVE", "On until the last working day");
  await must(db.from("employment_contract").update({ lastWorkingDay: addDays(start, -1), startDate: addDays(start, -5) }).eq("id", renewal.id), "Shift resignation");
  await tick();
  assert.equal((await db.from("staff_profile").select("status").eq("id", staff.id).single()).data.status, "LEFT");
  assert.equal((await db.from("app_user").select("status").eq("id", user.id).single()).data.status, "INACTIVE");
  assert.ok((await db.from("notification").select("id").eq("userId", hr.id).eq("kind", "CONTRACT_ENDED")).data.length);
  pass("A resignation keeps the login on until the last day, then the daily job switches it off");

  // --- Teams, roles and templates ------------------------------------------
  await adm.goto(`${base}/users/${plain.id}/teams`, { waitUntil: "networkidle" });
  assert.ok((await adm.locator('select[name="teamType"] option').allTextContents()).includes("Development"), "New team types offered");
  const row = adm.locator(`[data-team-row="QA Team ${run}"]`);
  await row.getByRole("textbox").fill("Lead tester");
  await row.getByRole("button", { name: "Add" }).click();
  await until(async () => (await db.from("team_member").select("roleInTeam").eq("userId", plain.id).eq("teamId", ids.team).maybeSingle()).data?.roleInTeam === "Lead tester", "part in team");
  pass("Someone joins a team with their part in it, and team types include Development and QA");

  await adm.goto(`${base}/settings`, { waitUntil: "networkidle" });
  const combine = adm.locator("[data-combine-roles]");
  const marketingId = marketing.id;
  const sales = await must(db.from("security_role").select("id").eq("name", "Sales").single(), "Sales role");
  await combine.getByLabel("First role").selectOption(marketingId);
  await combine.getByLabel("Second role").selectOption(sales.id);
  await combine.getByRole("button", { name: "Combine" }).click();
  const roleName = adm.getByPlaceholder("Finance");
  await roleName.waitFor();
  assert.equal(await roleName.inputValue(), "Marketing + Sales");
  await roleName.fill(`QA Combined ${run}`);
  await adm.getByRole("button", { name: "Create role" }).click();
  const combined = await until(async () => (await db.from("security_role").select("*").eq("name", `QA Combined ${run}`).maybeSingle()).data, "combined role");
  ids.combinedRole = combined.id;
  assert.equal(combined.dataScope, "OWN");
  assert.ok(combined.permissions.includes("opportunity:write") && combined.permissions.includes("lead:write"));
  pass("Two roles combine into one with both sets of permissions, seeing as narrowly as the narrower");

  await hrPage.goto(`${base}/people/templates`, { waitUntil: "networkidle" });
  await hrPage.getByRole("button", { name: "New template" }).click();
  await hrPage.locator('input[name="templateName"]').fill(`QA Template ${run}`);
  await hrPage.locator('select[name="templateType"]').selectOption("TRAINING");
  await hrPage.locator('textarea[name="templateBody"]').fill("QA TRAINING for {{fullName}} from {{startDate}} to {{endDate}}.");
  await hrPage.getByRole("button", { name: "Save template" }).click();
  const template = await until(async () => (await db.from("contract_template").select("id").eq("name", `QA Template ${run}`).maybeSingle()).data, "template");
  ids.template = template.id;
  pass("Whoever manages contracts can add a template");

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
  const users = [ids.admin, ids.hr, ids.manager, ids.plain, ids.hire].filter(Boolean);
  if (ids.staff) {
    const all = (await db.from("employment_contract").select("id").eq("staffId", ids.staff)).data ?? [];
    ids.contracts = [...new Set([...ids.contracts, ...all.map((c) => c.id)])];
    await clean("documents", () => db.from("document").delete().in("relatedEntityId", [ids.staff, ...ids.contracts]));
    await clean("contracts", () => db.from("employment_contract").delete().eq("staffId", ids.staff));
    await clean("profile", () => db.from("staff_profile").delete().eq("id", ids.staff));
    await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.staff, ...ids.contracts]));
  }
  if (ids.template) await clean("template", () => db.from("contract_template").delete().eq("id", ids.template));
  await clean("team members", () => db.from("team_member").delete().eq("teamId", ids.team));
  await clean("team", () => db.from("team").delete().eq("id", ids.team));
  for (const user of users) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record", "team_member"]) await clean(t, () => db.from(t).delete().eq("userId", user));
    await clean("audit by user", () => db.from("audit_history").delete().eq("changedById", user));
    await clean("user", () => db.from("app_user").delete().eq("id", user));
    await db.auth.admin.deleteUser(user).catch(() => {});
  }
  await clean("roles", () => db.from("security_role").delete().in("id", [ids.adminRole, ids.hrRole, ids.plainRole, ids.combinedRole].filter(Boolean)));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
