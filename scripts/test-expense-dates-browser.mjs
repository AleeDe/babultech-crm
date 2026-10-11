// Filtering expenses by the day they happened - in a real browser.
//
// Three claims on different days: today, 40 days ago, and last year. The list
// opens on all time; This year, Last N days and a custom range each show the
// right ones; the period survives a status filter and a search, and the
// totals and the export follow it. Everything created is removed.
//
// Usage: node scripts/test-expense-dates-browser.mjs http://localhost:3100
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
const now = () => new Date().toISOString();
const day = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const thisYear = new Date().getUTCFullYear();
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
async function urlMatches(page, re) {
  for (let i = 0; i < 60; i++) { if (re.test(page.url())) return; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`The address never matched ${re}: ${page.url()}`);
}
async function must(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = { user: null, today: randomUUID(), recent: randomUUID(), lastYear: randomUUID() };
const num = { today: `QA-ED1-${run}`, recent: `QA-ED2-${run}`, lastYear: `QA-ED3-${run}` };
let browser;

try {
  const crm = await must(db.from("security_role").select("id").eq("name", "CRM Admin").single(), "CRM Admin");
  const email = `expdates-${run.toLowerCase()}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.user = auth.data.user.id;
  await must(db.from("app_user").insert({ id: ids.user, fullName: `QA Expense Dates ${run}`, email, roleId: crm.id, status: "ACTIVE", updatedAt: now() }), "Login");
  const category = await must(db.from("expense_category").select("id").limit(1).single(), "Category");
  const claim = (id, number, date, amount, status) => ({
    id, expenseNumber: number, categoryId: category.id, expenseDate: date, amount, currencyCode: "PKR",
    description: `QA dated claim ${run}`, employeeUserId: ids.user, reimbursable: true, approvalStatus: status, updatedAt: now(),
  });
  await must(db.from("expense").insert([
    claim(ids.today, num.today, day(0), 100, "APPROVED"),
    claim(ids.recent, num.recent, day(-40), 200, "DRAFT"),
    claim(ids.lastYear, num.lastYear, `${thisYear - 1}-06-15`, 400, "APPROVED"),
  ]), "Claims");
  pass("Three claims: today, 40 days ago, and last year");

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  const shown = async () => {
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    return Object.entries(num).filter(([, n]) => text.includes(n)).map(([k]) => k).sort();
  };

  await page.goto(`${base}/expenses?search=${run}`, { waitUntil: "networkidle" });
  assert.deepEqual(await shown(), ["lastYear", "recent", "today"], "All time by default");
  assert.equal(await page.getByLabel("Date range").inputValue(), "all");
  pass("The list opens on All time, as before");

  // This year, chosen from the picker: the search stays.
  await page.getByLabel("Date range").selectOption("this_year");
  await urlMatches(page, /range=this_year/);
  assert.match(page.url(), new RegExp(`search=${run}`), "The search survives a period change");
  assert.deepEqual(await shown(), ["recent", "today"]);
  pass("This year shows this year's claims, and keeps the search");

  // Last 30 days.
  await page.getByLabel("Date range").selectOption("last_n_days");
  await page.getByLabel("Number of days").fill("30");
  await page.getByRole("button", { name: "Apply" }).click();
  await urlMatches(page, /days=30/);
  assert.deepEqual(await shown(), ["today"]);
  pass("Last 30 days shows only today's claim");

  // A status filter keeps the period.
  await page.goto(`${base}/expenses?search=${run}&range=custom&from=${thisYear - 1}-01-01&to=${day(0)}`, { waitUntil: "networkidle" });
  assert.deepEqual(await shown(), ["lastYear", "recent", "today"]);
  await page.getByLabel("Any approval").selectOption("APPROVED");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.waitForURL(/approvalStatus=APPROVED/);
  assert.match(page.url(), /range=custom/, "The period survives a status filter");
  assert.deepEqual(await shown(), ["lastYear", "today"]);
  pass("A custom range with a status filter: both apply, and the period stays in the address");

  // Totals and export follow the period.
  await page.goto(`${base}/expenses?search=${run}&range=custom&from=${day(-45)}&to=${day(-35)}`, { waitUntil: "networkidle" });
  assert.deepEqual(await shown(), ["recent"]);
  await page.getByText("Total (filtered)").waitFor();
  await page.getByText("1 expense", { exact: true }).waitFor();
  const href = await page.getByRole("link", { name: "Export" }).getAttribute("href");
  assert.match(href, /range=custom/);
  const csv = await (await context.request.get(`${base}${href}`)).text();
  assert.ok(csv.includes(num.recent) && !csv.includes(num.today) && !csv.includes(num.lastYear), "The export is the period's claims");
  pass("The total counts only the period, and the export contains only its claims");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  await db.from("audit_history").delete().in("entityId", [ids.today, ids.recent, ids.lastYear]);
  await db.from("expense").delete().in("id", [ids.today, ids.recent, ids.lastYear]);
  if (ids.user) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record"]) await db.from(t).delete().eq("userId", ids.user);
    await db.from("audit_history").delete().eq("changedById", ids.user);
    await db.from("app_user").delete().eq("id", ids.user);
    await db.auth.admin.deleteUser(ids.user).catch(() => {});
  }
  console.log("Temporary data removed.");
}
