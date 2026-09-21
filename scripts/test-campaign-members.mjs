// Campaign members, against the real database.
//
// The parts worth proving are the ones that are easy to get subtly wrong: that
// a member exists once rather than once per campaign, that importing the same
// list twice updates rather than duplicates, that a thin second file does not
// wipe details somebody entered by hand, and that the permission gate holds.
//
// Cleans up after itself.
//
// Usage: node scripts/test-campaign-members.mjs
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
config({ path: ".env", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const run = randomUUID().slice(0, 8);
const now = () => new Date().toISOString();
const cleanup = [];
const passed = [];
const pass = (n) => { passed.push(n); console.log(`PASS ${n}`); };

async function ok(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const email = (n) => `cm-${run}-${n}@example.com`;
// Unique per run: the dedupe matches on the last nine digits, so a fixed
// number would find whatever the previous run left behind.
const suffix = String(Math.floor(Math.random() * 9e6) + 1e6);
const phoneA = `0300 ${suffix}`;
const phoneB = `+92 321 ${suffix}`;
const phoneBAlt = `0321${suffix}`;

try {
  // --- two identities: one who may work leads, one who may not -------------
  const superRole = await ok(
    admin.from("security_role").select("id").contains("permissions", ["*"]).limit(1).single(),
    "Find Super Admin",
  );
  const noLeadRole = await ok(
    admin.from("security_role").select("id, name, permissions").eq("name", "Consultant").single(),
    "Find Consultant",
  );
  assert.ok(
    !noLeadRole.permissions.some((p) => p === "lead:read" || p === "lead:*" || p === "*"),
    "The Consultant role must not hold lead:read for this test to mean anything",
  );

  async function makeUser(label, roleId) {
    const address = `cm-user-${run}-${label}@example.com`;
    const password = randomBytes(18).toString("base64url");
    const auth = await admin.auth.admin.createUser({
      email: address, password, email_confirm: true,
    });
    if (auth.error) throw auth.error;
    const id = auth.data.user.id;
    cleanup.push(() => admin.auth.admin.deleteUser(id));

    await ok(
      admin.from("app_user").insert({
        id, fullName: `CM ${label} ${run}`, email: address, roleId,
        userType: "INTERNAL", status: "ACTIVE", updatedAt: now(),
      }),
      `Create the ${label} user`,
    );
    cleanup.push(() => admin.from("app_user").delete().eq("id", id));

    const client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signIn = await client.auth.signInWithPassword({ email: address, password });
    if (signIn.error) throw new Error(`${label} sign-in: ${signIn.error.message}`);
    return { id, client };
  }

  const marketer = await makeUser("marketer", superRole.id);
  const outsider = await makeUser("outsider", noLeadRole.id);

  // By owner rather than by email: a member with no address is invisible to an
  // email filter, so an email-based cleanup silently leaves them behind. Pushed
  // before the users are removed, since cleanup runs in reverse.
  cleanup.push(() =>
    admin.from("campaign_member").delete().in("ownerUserId", [marketer.id, outsider.id]),
  );

  // --- 1. the import -------------------------------------------------------

  const firstFile = [
    { firstName: "Ayesha", lastName: "Malik", email: email(1), phone: phoneA,
      companyName: "Meridian Foods", businessType: "MANUFACTURING", companySize: "MEDIUM",
      city: "Lahore", source: `Trade show ${run}` },
    { firstName: "Bilal", lastName: "Ahmed", email: email(2),
      companyName: "Sapphire Textiles", companySize: "LARGE" },
    // No address, but a phone number - the case a trade-show sheet is full of.
    { firstName: "Phone Only", lastName: "Person", phone: phoneB },
    { firstName: "", lastName: "Blank row" },
  ];

  const firstRaw = await ok(
    marketer.client.rpc("import_campaign_members", { p_rows: firstFile, p_owner: marketer.id }),
    "Import the first file",
  );
  const first = typeof firstRaw === "string" ? JSON.parse(firstRaw) : firstRaw;

  assert.equal(first.added, 3, "Three rows have a first name and should be added");
  assert.equal(first.skipped, 1, "The row with no first name should be skipped, not fail the file");
  pass("A list imports, and a blank row is skipped rather than failing the file");

  // --- 2. importing it again --------------------------------------------

  const secondRaw = await ok(
    marketer.client.rpc("import_campaign_members", { p_rows: firstFile, p_owner: marketer.id }),
    "Import the same file again",
  );
  const second = typeof secondRaw === "string" ? JSON.parse(secondRaw) : secondRaw;

  assert.equal(second.added, 0, "Nobody in the same file should be added a second time");
  assert.equal(second.updated, 3, "All three should be matched - two on email, one on phone");
  pass("Re-importing matches the same people, on email or on phone, and adds nobody");

  const { count: ayeshas } = await admin
    .from("campaign_member")
    .select("id", { count: "exact", head: true })
    .eq("email", email(1))
    .is("deletedAt", null);
  assert.equal(ayeshas, 1, "There must be exactly one row for that address");
  pass("One person, one row, however many times their list is imported");

  // --- 3. a thin file must not wipe what is on file ------------------------

  const thinFile = [{ firstName: "Ayesha", lastName: "Malik", email: email(1) }];
  await ok(
    marketer.client.rpc("import_campaign_members", { p_rows: thinFile, p_owner: marketer.id }),
    "Import a file with only names",
  );

  const ayesha = await ok(
    admin.from("campaign_member")
      .select("phone, companyName, businessType, companySize, city")
      .eq("email", email(1)).single(),
    "Re-read her record",
  );
  assert.equal(ayesha.phone, phoneA, "A blank cell must not clear a phone number");
  assert.equal(ayesha.companyName, "Meridian Foods", "A blank cell must not clear a company");
  assert.equal(ayesha.businessType, "MANUFACTURING", "A blank cell must not clear a business type");
  pass("A thinner second file tops up details rather than wiping them");

  // A number written the other way round is the same number.
  const reformattedRaw = await ok(
    marketer.client.rpc("import_campaign_members", {
      p_rows: [{ firstName: "Phone Only", lastName: "Person", phone: phoneBAlt }],
      p_owner: marketer.id,
    }),
    "Import the same number, written differently",
  );
  const reformatted = typeof reformattedRaw === "string" ? JSON.parse(reformattedRaw) : reformattedRaw;
  assert.equal(reformatted.added, 0, "A reformatted phone number must not add a second copy");
  assert.equal(reformatted.updated, 1, "It should match the person already on the list");
  pass("A phone number written differently still matches the same person");

  // --- 4. the dedupe index -------------------------------------------------

  const duplicate = await marketer.client.from("campaign_member").insert({
    id: randomUUID(), firstName: "Impostor", email: email(1), updatedAt: now(),
  }).select("id");
  assert.ok(
    duplicate.error || (duplicate.data ?? []).length === 0,
    "A second member on the same email must be refused",
  );
  pass("The same email address cannot be added twice");

  // Different case is the same address.
  const upper = await marketer.client.from("campaign_member").insert({
    id: randomUUID(), firstName: "Impostor", email: email(1).toUpperCase(), updatedAt: now(),
  }).select("id");
  assert.ok(
    upper.error || (upper.data ?? []).length === 0,
    "Case must not be a way around the dedupe",
  );
  pass("A differently-cased address is the same address");

  // --- 5. never-contacted is not the same as not-recently-contacted --------
  //
  // The filter that builds an audience has to include people with a null date,
  // or the ones most worth mailing silently drop out.
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
  // Matched on owner rather than on email: one of the three has no address at
  // all, and an email filter would drop them before the date filter was even
  // reached - which is exactly the mistake this check exists to catch.
  const contactable = await ok(
    marketer.client
      .from("campaign_member")
      .select("id, email, lastCampaignRunAt")
      .eq("ownerUserId", marketer.id)
      .or(`lastCampaignRunAt.is.null,lastCampaignRunAt.lt.${cutoff}`),
    "List people not contacted recently",
  );
  assert.equal(contactable.length, 3, "Everybody has a null date, so everybody should be offered");
  pass("Never-contacted people are offered when building an audience, not skipped");

  // --- 6. opting out -------------------------------------------------------

  const target = await ok(
    admin.from("campaign_member").select("id").eq("email", email(2)).single(),
    "Find the second member",
  );
  await ok(
    marketer.client.from("campaign_member")
      .update({ emailOptOut: true, emailOptOutAt: now(), updatedAt: now() })
      .eq("id", target.id),
    "Unsubscribe them",
  );

  const stillContactable = await ok(
    marketer.client
      .from("campaign_member")
      .select("id")
      .like("email", `cm-${run}-%@example.com`)
      .eq("emailOptOut", false)
      .not("email", "is", null),
    "List who can still be emailed",
  );
  assert.ok(
    !stillContactable.some((m) => m.id === target.id),
    "Somebody who unsubscribed must drop out of the contactable list",
  );
  pass("An unsubscribed member drops out of the emailable list");

  // --- 7. the permission gate ----------------------------------------------

  const outsiderRead = await outsider.client.from("campaign_member").select("id").limit(5);
  assert.equal(
    (outsiderRead.data ?? []).length, 0,
    "Somebody without lead:read must see no campaign members",
  );
  pass("Without lead:read, the list is empty");

  const outsiderWrite = await outsider.client.from("campaign_member").insert({
    id: randomUUID(), firstName: "Sneaky", email: email(99), updatedAt: now(),
  }).select("id");
  assert.ok(
    outsiderWrite.error || (outsiderWrite.data ?? []).length === 0,
    "Somebody without lead:write must not add a member",
  );
  pass("Without lead:write, a member cannot be added");

  const outsiderImport = await outsider.client.rpc("import_campaign_members", {
    p_rows: [{ firstName: "Sneaky", email: email(98) }], p_owner: outsider.id,
  });
  assert.ok(outsiderImport.error, "The import function must check the permission itself");
  pass("The import function refuses on its own, not only through the policy");

  console.log(`\n${passed.length} checks passed.`);
} finally {
  for (const undo of cleanup.reverse()) {
    try { await undo(); } catch (err) { console.error("Cleanup failed:", err.message); }
  }
  console.log("Temporary data removed.");
}
