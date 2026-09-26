// Loads one page in a real browser against the DEV server, where React prints
// the actual hydration mismatch rather than a minified error code.
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { randomUUID, randomBytes } from "node:crypto";
config({ path: ".env", quiet: true });

const base = process.argv[2];
const paths = process.argv.slice(3).map((p) => (p.startsWith("/") ? p : "/" + p));
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const run = randomUUID().slice(0, 8);
const roleId = randomUUID();
let userId = null;
const now = () => new Date().toISOString();

try {
  await db.from("security_role").insert({ id: roleId, name: `Hydration ${run}`, permissions: ["*"], dataScope: "ALL", updatedAt: now() });
  const password = randomBytes(24).toString("base64url");
  const email = `hydration-${run}@example.com`;
  const auth = await db.auth.admin.createUser({ email, password, email_confirm: true });
  userId = auth.data.user.id;
  await db.from("app_user").insert({ id: userId, fullName: "Hydration check", email, roleId, status: "ACTIVE", updatedAt: now() });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const messages = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") messages.push(m.text()); });
  page.on("pageerror", (e) => messages.push("PAGEERROR " + e.message));

  await page.goto(`${base}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 60000 });

  for (const path of paths) {
    messages.length = 0;
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    console.log(`\n=== ${path} ===`);
    const hydration = messages.filter((m) => /hydrat|did not match|server rendered/i.test(m));
    for (const m of (hydration.length ? hydration : messages).slice(0, 2)) {
      console.log(m.slice(0, 1800));
    }
    if (messages.length === 0) console.log("  no console errors");
  }
  await browser.close();
} finally {
  if (userId) {
    await db.from("app_user").delete().eq("id", userId);
    await db.auth.admin.deleteUser(userId);
  }
  await db.from("security_role").delete().eq("id", roleId);
}
