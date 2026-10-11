// Saving a product with a description - in a real browser.
//
// A CRM Admin creates a service with a formatted description and a link. It
// saves (it used to crash on Vercel, where the old cleaner's jsdom could not
// load), the description keeps its formatting, and the link is made safe.
// Everything created is removed.
//
// Usage: node scripts/test-product-description-browser.mjs http://localhost:3100
//        (also safe against the live site: it only adds and removes its own rows)
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";

config({ path: ".env", quiet: true });
const base = process.argv[2] || "http://localhost:3100";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const run = randomUUID().slice(0, 6).toUpperCase();
const passed = [];
const errors = [];
const pass = (what) => { passed.push(what); console.log(`  PASS  ${what}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let userId = null;
let productId = null;
let browser;

try {
  const crm = (await db.from("security_role").select("id").eq("name", "CRM Admin").single()).data;
  const email = `proddesc-${run.toLowerCase()}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  userId = auth.data.user.id;
  await db.from("app_user").insert({ id: userId, fullName: `QA Product Desc ${run}`, email, roleId: crm.id, status: "ACTIVE", updatedAt: new Date().toISOString() });
  pass("A CRM Admin");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  await page.goto(`${base}/products/new`, { waitUntil: "networkidle" });
  await page.locator('input[name="name"]').fill(`QA Described Service ${run}`);
  const editor = page.getByRole("textbox", { name: /Description/ });
  await editor.click();
  await page.keyboard.type(`Includes setup and training ${run}.`);
  // Paste-like markup straight into the field the form submits.
  await page.locator('input[type="hidden"][name="description"]').evaluate((el, r) => {
    el.value = `<p><strong>Includes setup</strong> and training ${r}.</p><p><a href="javascript:alert(1)">bad</a> <a href="https://www.babultech.com">site</a></p><script>alert(1)</script>`;
  }, run);
  await page.locator('button[type="submit"]').last().click();
  await page.waitForURL(/\/products\/[0-9a-f-]{36}$/, { timeout: 30000 });
  assert.equal(await page.getByText("Something went wrong").count(), 0, "No error page");
  const saved = (await db.from("product").select("id, description").eq("name", `QA Described Service ${run}`).single()).data;
  productId = saved.id;
  pass("A product with a description saves, and opens its page");

  const html = saved.description ?? "";
  assert.ok(html.includes(run), "The text is kept");
  assert.ok(!html.includes("<script"), "Scripts are removed");
  assert.ok(!html.includes("javascript:"), "Unsafe links lose their address");
  if (html.includes("babultech.com")) assert.match(html, /target="_blank"/, "Safe links open in a new tab");
  pass("The description is cleaned: text kept, scripts and unsafe links removed");

  assert.equal(errors.length, 0, `Browser errors:\n${errors.map((e) => `  ${e.url}: ${e.message.slice(0, 200)}`).join("\n")}`);
  pass("No browser runtime errors");
  console.log(`\n${passed.length} checks passed.\n`);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (productId) {
    await db.from("audit_history").delete().eq("entityId", productId);
    await db.from("product").delete().eq("id", productId);
  } else {
    await db.from("product").delete().eq("name", `QA Described Service ${run}`);
  }
  if (userId) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record"]) await db.from(t).delete().eq("userId", userId);
    await db.from("audit_history").delete().eq("changedById", userId);
    await db.from("app_user").delete().eq("id", userId);
    await db.auth.admin.deleteUser(userId).catch(() => {});
  }
  await wait(0);
  console.log("Temporary data removed.");
}
