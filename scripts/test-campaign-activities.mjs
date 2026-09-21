// Campaign activities, against the real database.
//
// No email is actually sent: the send path needs a provider, and what matters
// here is everything around it — who is allowed into an audience, that a
// frozen activity stays frozen, that running one stamps the people it reached,
// that the webhook's bookkeeping is right, and that the unsubscribe link works
// for somebody with no account at all.
//
// Cleans up after itself.
//
// Usage: node scripts/test-campaign-activities.mjs
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
const parse = (d) => (typeof d === "string" ? JSON.parse(d) : d);

try {
  const superRole = await ok(
    admin.from("security_role").select("id").contains("permissions", ["*"]).limit(1).single(),
    "Find Super Admin",
  );

  const address = `ca-user-${run}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const auth = await admin.auth.admin.createUser({ email: address, password, email_confirm: true });
  if (auth.error) throw auth.error;
  const meId = auth.data.user.id;
  cleanup.push(() => admin.auth.admin.deleteUser(meId));

  await ok(
    admin.from("app_user").insert({
      id: meId, fullName: `CA Marketer ${run}`, email: address, roleId: superRole.id,
      userType: "INTERNAL", status: "ACTIVE", updatedAt: now(),
    }),
    "Create the marketer",
  );
  cleanup.push(() => admin.from("app_user").delete().eq("id", meId));

  const db = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await db.auth.signInWithPassword({ email: address, password });
  if (signIn.error) throw signIn.error;

  // --- a campaign and four members ----------------------------------------

  const campaignType = await ok(
    admin.from("campaign_type").select("id").limit(1).single(),
    "Find a campaign type",
  );

  const campaignId = randomUUID();
  await ok(
    db.from("campaign").insert({
      id: campaignId, campaignNumber: `CA-${run}`, name: `CA Campaign ${run}`,
      campaignTypeId: campaignType.id, status: "ACTIVE", ownerUserId: meId, updatedAt: now(),
    }),
    "Create a campaign",
  );
  cleanup.push(() => admin.from("campaign").delete().eq("id", campaignId));

  const members = {
    good: randomUUID(),
    optedOut: randomUUID(),
    bounced: randomUUID(),
    noEmail: randomUUID(),
  };
  await ok(
    db.from("campaign_member").insert([
      // Every row carries the same keys: a bulk insert through PostgREST sends
      // one column list for all of them, so a key missing from one row arrives
      // as null rather than falling back to the column default.
      { id: members.good, firstName: "Good", lastName: `One ${run}`,
        email: `ca-good-${run}@example.com`, phone: null,
        emailOptOut: false, emailBounced: false, ownerUserId: meId, updatedAt: now() },
      { id: members.optedOut, firstName: "Opted", lastName: `Out ${run}`,
        email: `ca-out-${run}@example.com`, phone: null,
        emailOptOut: true, emailBounced: false, ownerUserId: meId, updatedAt: now() },
      { id: members.bounced, firstName: "Bounced", lastName: `Address ${run}`,
        email: `ca-bounce-${run}@example.com`, phone: null,
        emailOptOut: false, emailBounced: true, ownerUserId: meId, updatedAt: now() },
      { id: members.noEmail, firstName: "No", lastName: `Address ${run}`,
        email: null, phone: "0300 9998887",
        emailOptOut: false, emailBounced: false, ownerUserId: meId, updatedAt: now() },
    ]),
    "Create members",
  );
  cleanup.push(() => admin.from("campaign_member").delete().in("id", Object.values(members)));

  // --- 1. an activity and its audience ------------------------------------

  const activityId = randomUUID();
  await ok(
    db.from("campaign_activity").insert({
      id: activityId, campaignId, name: `CA Intro email ${run}`,
      activityType: "EMAIL", status: "DRAFT", subject: "Hello {{firstName}}",
      bodyText: "A short note.", ownerUserId: meId, updatedAt: now(),
    }),
    "Create an activity",
  );
  cleanup.push(() => admin.from("campaign_activity").delete().eq("id", activityId));

  const addedRaw = await ok(
    db.rpc("add_members_to_activity", {
      p_activity: activityId, p_members: Object.values(members),
    }),
    "Add everyone to the audience",
  );
  const added = parse(addedRaw);
  assert.equal(added.added, 4, "All four should be added");
  pass("An audience is built from chosen members");

  // Adding the same people again must be a no-op that says so, not a
  // duplicate send.
  const againRaw = await ok(
    db.rpc("add_members_to_activity", {
      p_activity: activityId, p_members: Object.values(members),
    }),
    "Add them again",
  );
  const again = parse(againRaw);
  assert.equal(again.added, 0, "Nobody should be added twice");
  assert.equal(again.alreadyThere, 4, "It should report that all four were already there");
  pass("Adding the same people again adds nobody, and says so");

  // --- 2. who can actually be emailed -------------------------------------
  //
  // The send skips the opted-out, the bounced and the address-less. Checked
  // here as the query the sender runs, because getting this wrong is the
  // difference between a campaign and a complaint.
  const sendable = await ok(
    db.from("campaign_activity_member")
      .select("memberId, member:campaign_member ( email, emailOptOut, emailBounced, active )")
      .eq("activityId", activityId),
    "Read the audience with each member's state",
  );
  const allowed = sendable.filter(
    (r) => r.member.email && !r.member.emailOptOut && !r.member.emailBounced && r.member.active,
  );
  assert.equal(allowed.length, 1, "Only one of the four may be emailed");
  assert.equal(allowed[0].memberId, members.good, "And it must be the one with a usable address");
  pass("Unsubscribed, bounced and address-less people are excluded from a send");

  // --- 3. running it -------------------------------------------------------

  const ranRaw = await ok(db.rpc("mark_activity_run", { p_activity: activityId }), "Mark it run");
  const ran = parse(ranRaw);
  assert.equal(ran.touched, 4, "Everyone in the audience should be stamped");

  const stamped = await ok(
    admin.from("campaign_member")
      .select("id, lastCampaignRunAt, lastCampaignId, campaignCount")
      .in("id", Object.values(members)),
    "Re-read the members",
  );
  assert.ok(stamped.every((m) => m.lastCampaignRunAt), "Everyone should have a last-contacted date");
  assert.ok(stamped.every((m) => m.lastCampaignId === campaignId), "It should name the campaign");
  assert.ok(stamped.every((m) => m.campaignCount === 1), "And count one campaign each");
  pass("Running an activity stamps everyone it reached, with the campaign and a count");

  const after = await ok(
    admin.from("campaign_activity").select("status, completedAt").eq("id", activityId).single(),
    "Re-read the activity",
  );
  assert.equal(after.status, "COMPLETED", "The activity should be completed");
  pass("The activity closes itself when it runs");

  // --- 4. a run activity is frozen ----------------------------------------

  const late = await db.rpc("add_members_to_activity", {
    p_activity: activityId, p_members: [members.good],
  });
  assert.ok(late.error, "Adding to a completed activity must be refused");
  assert.match(late.error.message, /already run/i, "The refusal should say why");
  pass("The audience of a completed activity cannot be changed");

  // --- 5. the webhook's bookkeeping ---------------------------------------
  //
  // Simulating what the route does when the provider reports events. The first
  // open sets the date; later ones only raise the count, because the date is
  // "when they first read it" and the count is "how interested they are".
  const row = await ok(
    admin.from("campaign_activity_member").select("id")
      .eq("activityId", activityId).eq("memberId", members.good).single(),
    "Find the sent row",
  );

  const firstOpen = now();
  await ok(
    admin.from("campaign_activity_member")
      .update({ sentAt: firstOpen, deliveredAt: firstOpen, openedAt: firstOpen, openCount: 1, updatedAt: firstOpen })
      .eq("id", row.id),
    "Record the first open",
  );
  await new Promise((r) => setTimeout(r, 50));
  const secondOpen = now();
  const current = await ok(
    admin.from("campaign_activity_member").select("openedAt, openCount").eq("id", row.id).single(),
    "Read it back",
  );
  await ok(
    admin.from("campaign_activity_member")
      .update({ openedAt: current.openedAt ?? secondOpen, openCount: current.openCount + 1, updatedAt: secondOpen })
      .eq("id", row.id),
    "Record a second open",
  );

  const opened = await ok(
    admin.from("campaign_activity_member").select("openedAt, openCount").eq("id", row.id).single(),
    "Read the open figures",
  );
  assert.equal(opened.openCount, 2, "A second open must raise the count");
  // Compared as instants, not strings: the column is a timestamp without a
  // zone, so Postgres hands back ".5" where the client sent ".500Z".
  assert.equal(
    new Date(opened.openedAt + "Z").getTime(),
    new Date(firstOpen).getTime(),
    "But must not move the first-opened date",
  );
  pass("A repeat open raises the count and leaves the first-opened date alone");

  // --- 6. unsubscribing from a link ---------------------------------------
  //
  // Called with the anonymous key, as the public page does: whoever clicks has
  // no session at all.
  const token = await ok(
    admin.from("campaign_member").select("unsubscribeToken").eq("id", members.good).single(),
    "Read the unsubscribe token",
  );

  const publicClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const unsub = await publicClient.rpc("unsubscribe_by_token", { p_token: token.unsubscribeToken });
  assert.ok(!unsub.error, `An anonymous visitor must be able to unsubscribe: ${unsub.error?.message}`);

  const goneOut = await ok(
    admin.from("campaign_member").select("emailOptOut, emailOptOutAt").eq("id", members.good).single(),
    "Re-read the member",
  );
  assert.equal(goneOut.emailOptOut, true, "They must now be opted out");
  assert.ok(goneOut.emailOptOutAt, "And the date it happened must be recorded");
  pass("An unsubscribe link works with no account, and records when");

  const marked = await ok(
    admin.from("campaign_activity_member").select("unsubscribedAt").eq("id", row.id).single(),
    "Check the activity row",
  );
  assert.ok(marked.unsubscribedAt, "The email they left from must be marked too");
  pass("The email somebody unsubscribed from is credited with it");

  // A token that belongs to nobody answers exactly as one that does.
  const nonsense = await publicClient.rpc("unsubscribe_by_token", { p_token: randomUUID() });
  assert.ok(!nonsense.error, "An unknown token must not error");
  assert.deepEqual(
    parse(nonsense.data), parse(unsub.data),
    "An unknown token must be answered identically, or it confirms which tokens are real",
  );
  pass("An unknown token is answered the same way, so guessing reveals nothing");

  // --- 7. an anonymous visitor can do nothing else ------------------------

  const peek = await publicClient.from("campaign_member").select("id").limit(5);
  assert.equal((peek.data ?? []).length, 0, "An anonymous visitor must not read the member list");

  const peekActivity = await publicClient.from("campaign_activity").select("id").limit(5);
  assert.equal((peekActivity.data ?? []).length, 0, "Nor the activities");
  pass("Beyond unsubscribing, an anonymous visitor sees nothing");

  console.log(`\n${passed.length} checks passed.`);
} finally {
  for (const undo of cleanup.reverse()) {
    try { await undo(); } catch (err) { console.error("Cleanup failed:", err.message); }
  }
  console.log("Temporary data removed.");
}
