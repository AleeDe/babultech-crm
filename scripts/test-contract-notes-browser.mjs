// Contracts: bold wording, special notes, and deleting old contracts - in a
// real browser.
//
// An administrator makes words bold and adds special notes to a draft; both
// show on the signing page and the printout, and the hire can still sign (the
// notes are part of what is signed). Then cancelled and draft contracts are
// deleted from the person's page and the contract page, a contract being
// signed is refused, and one comes back from the recycle bin. Everything
// created is removed; no email is sent.
//
// Usage: node scripts/test-contract-notes-browser.mjs http://localhost:3100
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
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
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

const ids = { adminRole: randomUUID(), admin: null, staff: randomUUID(), main: randomUUID(), cancelled: randomUUID(), draft: randomUUID() };
let browser;
const contractRow = (id, status, extra = {}) => ({
  id, contractNumber: `QA-${id.slice(0, 8)}`, staffId: ids.staff, contractType: "INTERNSHIP", tenureMonths: 3, startDate: today(),
  endDate: "2099-01-01", jobTitle: "Intern", status, updatedAt: now(), ...extra,
});
const contract = async (id) => (await db.from("employment_contract").select("*").eq("id", id).single()).data;

try {
  await must(db.from("security_role").insert({ id: ids.adminRole, name: `QA Notes Admin ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() }), "Role");
  const email = `cnote-admin-${lower}@example.com`;
  const password = `Pw-${randomBytes(12).toString("base64url")}9a`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (auth.error) throw new Error(auth.error.message);
  ids.admin = auth.data.user.id;
  await must(db.from("app_user").insert({ id: ids.admin, fullName: `QA Notes Admin ${run}`, email, roleId: ids.adminRole, status: "ACTIVE", updatedAt: now() }), "Login");
  await must(db.from("staff_profile").insert({ id: ids.staff, profileNumber: `QA-CN-${run}`, fullName: `QA Notes Hire ${run}`, status: "ONBOARDING", updatedAt: now() }), "Profile");
  const body = `INTERNSHIP AGREEMENT\n\nThe intern will work on the QA clause ${run} for three months.\n\nOther terms apply.`;
  await must(db.from("employment_contract").insert([
    contractRow(ids.main, "DRAFT", { body }),
    contractRow(ids.cancelled, "CANCELLED", { body: "Cancelled QA contract", endReason: "QA" }),
    contractRow(ids.draft, "DRAFT", { body: "Second draft QA contract" }),
  ]), "Contracts");
  pass("An administrator, a hire, and a draft, a cancelled and a second draft contract");

  browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  page.on("pageerror", (e) => errors.push({ url: page.url(), message: e.message }));
  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  // --- Bold and special notes ------------------------------------------------
  await page.goto(`${base}/people/contracts/${ids.main}`, { waitUntil: "networkidle" });
  const text = page.locator('textarea[name="contractBody"]');
  const phrase = `QA clause ${run}`;
  await text.evaluate((el, p) => { const i = el.value.indexOf(p); el.focus(); el.setSelectionRange(i, i + p.length); }, phrase);
  await page.getByRole("button", { name: "Bold" }).click();
  assert.ok((await text.inputValue()).includes(`**${phrase}**`), "The selected words are wrapped for bold");
  await page.locator('textarea[name="specialNotes"]').fill(`**Probation of one month applies.**\nLaptop ${run} to be returned on leaving.`);
  await page.getByRole("button", { name: "Preview" }).click();
  await page.locator("strong", { hasText: phrase }).waitFor();
  await page.locator("[data-special-notes]").getByText("Probation of one month applies.").waitFor();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByRole("button", { name: "Save wording" }).click();
  await until(async () => (await contract(ids.main)).specialNotes?.includes(`Laptop ${run}`), "notes saved");
  assert.ok((await contract(ids.main)).body.includes(`**${phrase}**`));
  pass("Words are made bold with the Bold button, special notes are added, and the preview shows both");

  // --- Sent, signed by the hire, printed ---------------------------------------
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Get signing link" }).click();
  const link = await page.locator('input[name="signingLink"]').inputValue();
  const signing = await (await browser.newContext()).newPage();
  signing.on("pageerror", (e) => errors.push({ url: signing.url(), message: e.message }));
  await signing.goto(link.replace(/^https?:\/\/[^/]+/, base));
  await signing.locator("strong", { hasText: phrase }).waitFor();
  await signing.locator("[data-special-notes]").getByText(`Laptop ${run} to be returned on leaving.`).waitFor();
  const pad = signing.locator("[data-signature-pad]");
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  await signing.mouse.move(box.x + 30, box.y + 60);
  await signing.mouse.down();
  for (let i = 1; i <= 10; i++) await signing.mouse.move(box.x + 30 + i * 20, box.y + (i % 2 ? 40 : 90));
  await signing.mouse.up();
  await signing.locator('input[name="agree"]').check();
  await signing.getByRole("button", { name: "Sign the contract" }).click();
  await signing.getByText("You signed this contract").waitFor({ timeout: 30000 });
  assert.equal((await contract(ids.main)).status, "EMPLOYEE_SIGNED");
  pass("The signing page shows the bold words and the notes, and the hire can sign them");

  await page.goto(`${base}/print/contracts/${ids.main}`, { waitUntil: "networkidle" });
  await page.locator("strong", { hasText: phrase }).waitFor();
  await page.locator("[data-special-notes]").getByText("Probation of one month applies.").waitFor();
  pass("The printout carries the bold words and the special notes");

  // --- Deleting -------------------------------------------------------------
  await page.goto(`${base}/people/contracts/${ids.main}`, { waitUntil: "networkidle" });
  const blocked = page.getByRole("button", { name: "Delete", exact: true });
  assert.equal(await blocked.isDisabled(), true, "A contract being signed cannot be deleted");
  assert.match(await blocked.getAttribute("title"), /being signed, signed or running/);
  pass("A contract being signed cannot be deleted, and says why");

  await page.goto(`${base}/people/${ids.staff}`, { waitUntil: "networkidle" });
  const cancelledNumber = `QA-${ids.cancelled.slice(0, 8)}`;
  const row = page.locator(`[data-row-actions="${cancelledNumber}"]`);
  await row.getByRole("button", { name: `Delete ${cancelledNumber}` }).click();
  await row.getByRole("button", { name: `Yes, delete ${cancelledNumber}` }).click();
  await until(async () => (await contract(ids.cancelled)).deletedAt, "cancelled deleted");
  await page.locator(`[data-row-actions="${cancelledNumber}"]`).waitFor({ state: "detached", timeout: 30000 });
  pass("A cancelled contract is deleted from the person's page and leaves the list");

  await page.goto(`${base}/people/contracts/${ids.draft}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await page.waitForURL(new RegExp(`/people/${ids.staff}$`), { timeout: 30000 });
  assert.ok((await contract(ids.draft)).deletedAt);
  await page.goto(`${base}/people/contracts/${ids.draft}`, { waitUntil: "networkidle" });
  assert.equal(await page.getByText("Second draft QA contract").count(), 0, "A deleted contract no longer opens");
  pass("A draft is deleted from its own page, which then goes back to the person");

  await page.goto(`${base}/recycle-bin`, { waitUntil: "networkidle" });
  const binRow = page.locator("tr, li").filter({ hasText: cancelledNumber }).first();
  await binRow.getByText("Contract (HR)").waitFor();
  await binRow.getByRole("button", { name: /Restore/ }).click();
  await until(async () => (await contract(ids.cancelled)).deletedAt === null, "restored");
  pass("Deleted contracts are in the recycle bin as Contract (HR) and can be restored");

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
  await clean("notifications for the contract", () => db.from("notification").delete().eq("entityId", ids.main));
  await clean("audit", () => db.from("audit_history").delete().in("entityId", [ids.staff, ids.main, ids.cancelled, ids.draft]));
  await clean("contracts", () => db.from("employment_contract").delete().eq("staffId", ids.staff));
  await clean("profile", () => db.from("staff_profile").delete().eq("id", ids.staff));
  if (ids.admin) {
    for (const t of ["notification", "record_follow", "recent_record", "login_event", "favorite_record"]) await clean(t, () => db.from(t).delete().eq("userId", ids.admin));
    await clean("audit by user", () => db.from("audit_history").delete().eq("changedById", ids.admin));
    await clean("user", () => db.from("app_user").delete().eq("id", ids.admin));
    await db.auth.admin.deleteUser(ids.admin).catch(() => {});
  }
  await clean("role", () => db.from("security_role").delete().eq("id", ids.adminRole));
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
