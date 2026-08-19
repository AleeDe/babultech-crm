/**
 * Moves team logins from personal Gmail addresses to @babultech.com.
 *
 * Sign-in identity lives in TWO places that must agree: auth.users (which
 * verifies the password) and app_user (which carries the profile). Changing one
 * without the other leaves an account that authenticates but has no profile, or
 * a profile nobody can sign in to. Both are updated here, in that order.
 *
 * Run with --dry first. Nothing is written and the mapping is printed, which is
 * the only chance to catch a typo before people lose access.
 *
 *   node scripts/switch-logins-to-domain.mjs --dry
 *   node scripts/switch-logins-to-domain.mjs --yes
 *
 * BEFORE RUNNING --yes: create each mailbox in Hostinger. The addresses below
 * become the only way these people sign in and the only way a password reset
 * can reach them, so an address nobody can open is a locked-out user.
 *
 * Reversible: re-run with the pairs inverted. Nothing else in the schema keys
 * off email — every foreign key uses the user id, which does not change here.
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

const db = createClient(url, key, { auth: { persistSession: false } });

/** Current sign-in address -> the address it becomes. */
const MAPPING = {
  "babul.tech786@gmail.com": "admin@babultech.com",
  "sammiiiullah@gmail.com": "sami@babultech.com",
  "muhammadali.abidi1416@gmail.com": "ali@babultech.com",
  "mh1915727@gmail.com": "hussain@babultech.com",
  "akbarali1512141@gmail.com": "akbar@babultech.com",
  "shabbirwrites14125@gmail.com": "shabbir@babultech.com",
  // Already on the domain; left here so the file lists the whole team.
  "hassan.shamsi@babultech.com": "hassan@babultech.com",
};

const dry = process.argv.includes("--dry");
const confirmed = process.argv.includes("--yes");

if (!dry && !confirmed) {
  console.error(
    "\nRefusing to run without a flag.\n" +
      "  --dry   show what would change\n" +
      "  --yes   apply it\n",
  );
  process.exit(1);
}

const { data: users, error } = await db
  .from("app_user")
  .select("id, fullName, email")
  .is("deletedAt", null);

if (error) {
  console.error("Could not read app_user:", error.message);
  process.exit(1);
}

console.log(`\n${dry ? "DRY RUN — nothing will be written" : "Applying"}\n`);

let changed = 0;
let skipped = 0;

for (const user of users) {
  const next = MAPPING[user.email];

  if (!next) {
    console.log(`  - ${user.fullName}: ${user.email} (not in the mapping, left alone)`);
    skipped += 1;
    continue;
  }

  if (next === user.email) {
    console.log(`  = ${user.fullName}: already ${next}`);
    skipped += 1;
    continue;
  }

  // A duplicate address would make sign-in ambiguous, and the unique index
  // would reject the write anyway — better to say so than to fail mid-run.
  const taken = users.find((u) => u.email === next && u.id !== user.id);
  if (taken) {
    console.error(`  x ${user.fullName}: ${next} is already used by ${taken.fullName}`);
    process.exit(1);
  }

  console.log(`  ${dry ? "?" : "+"} ${user.fullName}: ${user.email} -> ${next}`);

  if (dry) {
    changed += 1;
    continue;
  }

  // auth.users first. If this fails the profile is untouched and the user can
  // still sign in with their old address, which is the safe way to fail.
  const { error: authError } = await db.auth.admin.updateUserById(user.id, {
    email: next,
    email_confirm: true,
  });

  if (authError) {
    console.error(`  x ${user.fullName}: auth update failed — ${authError.message}`);
    process.exit(1);
  }

  const { error: profileError } = await db
    .from("app_user")
    .update({ email: next, updatedAt: new Date().toISOString() })
    .eq("id", user.id);

  if (profileError) {
    console.error(
      `  x ${user.fullName}: profile update failed after auth changed — ${profileError.message}\n` +
        `    auth.users now says ${next} but app_user still says ${user.email}. Fix before anyone signs in.`,
    );
    process.exit(1);
  }

  changed += 1;
}

console.log(
  `\n${dry ? "Would change" : "Changed"} ${changed}, left ${skipped} alone.` +
    (dry ? "\n\nRe-run with --yes to apply.\n" : "\n\nPasswords are unchanged. Tell everyone their new sign-in address.\n"),
);
