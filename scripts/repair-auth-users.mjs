/**
 * Give every app_user a matching Supabase Auth account.
 *
 * createUser() used to write only the app_user row, so anyone added through
 * the admin screens got a profile that looked correct everywhere in the UI and
 * could not sign in: NextAuth checked the bcrypt hash, passed, then asked
 * Supabase Auth for a session and was refused because no such user existed.
 *
 * That is fixed at the source in src/server/users.ts. This repairs the
 * accounts created before the fix.
 *
 * Two cases are handled, and they are not the same:
 *
 *   NO AUTH USER   — create one, reusing the app_user id so the two halves
 *                    keep the shared identity that RLS and ownerUserId assume.
 *
 *   ID MISMATCH    — an auth user exists under the same email but a different
 *                    id. Reported, never repaired: fixing it means deleting
 *                    and recreating the auth user, which invalidates their
 *                    sessions, and doing that automatically to an account
 *                    someone may be using is not this script's decision.
 *
 * Accounts that already line up are left alone — their passwords are NOT
 * reset. Only the accounts that cannot sign in at all are touched.
 *
 *   node scripts/repair-auth-users.mjs            # report only
 *   REPAIR_CONFIRM=yes node scripts/repair-auth-users.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const PASSWORD = process.env.SEED_PASSWORD ?? "BabulTech@2026";
const apply = process.env.REPAIR_CONFIRM === "yes";

const { data: profiles, error } = await db
  .from("app_user")
  .select("id, email, fullName, status, deletedAt");

if (error) {
  console.error("Could not read app_user:", error.message);
  process.exit(1);
}

const { data: authList, error: authErr } = await db.auth.admin.listUsers({ perPage: 1000 });
if (authErr) {
  console.error("Could not list auth users:", authErr.message);
  process.exit(1);
}

const byId = new Set(authList.users.map((u) => u.id));
const byEmail = new Map(authList.users.map((u) => [u.email?.toLowerCase(), u.id]));

const missing = [];
const mismatched = [];

for (const p of profiles) {
  if (p.deletedAt) continue;
  const email = p.email?.toLowerCase();
  if (byId.has(p.id)) continue;
  if (byEmail.has(email)) mismatched.push({ ...p, authId: byEmail.get(email) });
  else missing.push(p);
}

console.log(`app_user rows: ${profiles.length}   auth users: ${authList.users.length}`);
console.log(`cannot sign in (no auth account): ${missing.length}`);
console.log(`id mismatch (manual decision):    ${mismatched.length}\n`);

for (const m of mismatched) {
  console.log(`  ! ${m.email} — auth id ${m.authId.slice(0, 8)} vs profile ${m.id.slice(0, 8)}`);
}
if (mismatched.length) {
  console.log(
    "\n    Not repaired automatically: correcting these deletes and recreates the\n" +
      "    auth user, which signs that person out. Do it deliberately.\n",
  );
}

if (!missing.length) {
  console.log("Nothing to create.");
  process.exit(0);
}

for (const m of missing) console.log(`  + ${m.email} (${m.fullName})`);

if (!apply) {
  console.log(
    `\nReport only. Re-run with REPAIR_CONFIRM=yes to create these ${missing.length} auth ` +
      `account(s) with the password "${PASSWORD}".`,
  );
  process.exit(0);
}

console.log("");
let created = 0;

for (const m of missing) {
  const { error: e } = await db.auth.admin.createUser({
    // The id is forced to the profile's, not generated: auth.users.id ===
    // app_user.id is what ties a session to its owned rows.
    id: m.id,
    email: m.email.toLowerCase(),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { fullName: m.fullName },
  });

  if (e) {
    console.log(`  ${m.email}: FAILED — ${e.message}`);
    continue;
  }
  console.log(`  ${m.email}: created`);
  created += 1;
}

console.log(`\n${created} of ${missing.length} repaired. They can sign in with "${PASSWORD}".`);
console.log("Tell them to change it — this password is in the script's default.");
