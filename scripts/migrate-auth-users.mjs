/**
 * Moves app_user rows into Supabase Auth (auth.users).
 *
 * After this, auth.users is the identity of record and app_user is the profile:
 * both share the SAME id, so every existing foreign key (ownerUserId,
 * createdById, partnerId, …) keeps working untouched.
 *
 * The old bcrypt hashes in app_user.passwordHash cannot be carried over —
 * Supabase Auth hashes with its own scheme — so each user is created with a
 * known password and must reset it. For the seeded demo accounts that is the
 * same password they already had.
 *
 * Idempotent: users that already exist in auth.users are updated, not
 * duplicated.
 *
 * Run: node scripts/migrate-auth-users.mjs
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

// Admin API requires the service role.
const db = createClient(url, key, { auth: { persistSession: false } });

const DEFAULT_PASSWORD = process.env.SEED_PASSWORD ?? "BabulTech@2026";

const { data: profiles, error } = await db
  .from("app_user")
  .select("id, email, fullName, status")
  .is("deletedAt", null);

if (error) {
  console.error("Could not read app_user:", error.message);
  process.exit(1);
}

console.log(`\nMigrating ${profiles.length} users into Supabase Auth...\n`);

// Existing auth users, so re-runs update rather than fail.
const { data: existingList } = await db.auth.admin.listUsers({ perPage: 1000 });
const byEmail = new Map((existingList?.users ?? []).map((u) => [u.email, u]));

let created = 0;
let updated = 0;

for (const p of profiles) {
  const existing = byEmail.get(p.email);

  if (existing) {
    // Keep the auth id aligned with the profile id. If they ever diverge, every
    // FK in the schema silently points at the wrong person.
    if (existing.id !== p.id) {
      console.error(
        `  x ${p.email}: auth id ${existing.id} != app_user id ${p.id}. ` +
          `Delete the auth user and re-run.`,
      );
      process.exit(1);
    }
    await db.auth.admin.updateUserById(existing.id, {
      email_confirm: true,
      user_metadata: { full_name: p.fullName },
    });
    updated += 1;
    console.log(`  ~ ${p.email} (already present)`);
    continue;
  }

  // id is passed explicitly so auth.users.id === app_user.id.
  const { error: createErr } = await db.auth.admin.createUser({
    id: p.id,
    email: p.email,
    password: DEFAULT_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: p.fullName },
  });

  if (createErr) {
    console.error(`  x ${p.email}: ${createErr.message}`);
    process.exit(1);
  }

  created += 1;
  console.log(`  + ${p.email}`);
}

console.log(`
Done. created=${created} updated=${updated}

  auth.users.id now matches app_user.id, so existing foreign keys are intact.
  Password for migrated accounts: ${DEFAULT_PASSWORD}
`);
