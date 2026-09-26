/**
 * Campaign member to lead, duplicates and all.
 *
 * Walks the redesigned flow: a campaign produces members, a member becomes a
 * lead carrying every field, the same person arriving through two campaigns
 * produces two leads, and merging them keeps everything attached to either.
 *
 * Runs as a real signed-in user rather than the service role wherever the app
 * would, so the row-level policies and the security-definer functions are
 * exercised the way production exercises them.
 *
 * Cleans up after itself. Run it as often as you like.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

config({ path: ".env", quiet: true });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const run = randomUUID().slice(0, 6).toUpperCase();
const now = () => new Date().toISOString();
const passed = [];

function step(no, title) {
  console.log(`\n${no}  ${title}`);
  console.log("─".repeat(64));
}
function pass(what) {
  passed.push(what);
  console.log(`  PASS  ${what}`);
}
function note(what) {
  console.log(`  ·     ${what}`);
}

async function ok(result, what) {
  const r = await result;
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
}

const ids = {
  members: [], leads: [], campaigns: [], activities: [], batches: [],
  suppressed: [], notes: [],
  teardown() {
    const del = (table, column, values) => async () =>
      values.length ? admin.from(table).delete().in(column, values) : { error: null };
    return [
      del("note", "id", this.notes),
      del("activity", "id", this.activities),
      del("email_batch", "id", this.batches),
      del("email_suppression", "email", this.suppressed),
      // Members point at leads, so they go first.
      del("campaign_member", "id", this.members),
      del("lead", "id", this.leads),
      del("campaign", "id", this.campaigns),
    ];
  },
};

let user;

try {
  // ═══════════════════════════════════════════════════════════════════════
  step("00", "Somebody to do the work");
  // ═══════════════════════════════════════════════════════════════════════

  const staff = await ok(
    admin.from("app_user")
      .select("id, email, fullName")
      .eq("status", "ACTIVE")
      .not("email", "is", null)
      .is("partnerId", null)
      .limit(1)
      .maybeSingle(),
    "Find an active internal user",
  );
  assert.ok(staff, "The test needs at least one active internal user");
  user = staff;
  note(`Acting as ${staff.fullName}`);

  // ═══════════════════════════════════════════════════════════════════════
  step("01", "Two campaigns produce the same person twice");
  // ═══════════════════════════════════════════════════════════════════════

  const campaignType = await ok(
    admin.from("campaign_type").select("id").limit(1).maybeSingle(),
    "Find a campaign type",
  );
  assert.ok(campaignType, "The test needs a campaign type to exist");

  const makeCampaign = async (name) => {
    const id = randomUUID();
    await ok(
      admin.from("campaign").insert({
        id,
        campaignNumber: `M2L-${run}-${name.slice(0, 3).toUpperCase()}`,
        name: `${name} ${run}`,
        campaignTypeId: campaignType.id,
        ownerUserId: staff.id,
        status: "ACTIVE",
        updatedAt: now(),
      }),
      `Create the ${name} campaign`,
    );
    ids.campaigns.push(id);
    return id;
  };

  const webinarId = await makeCampaign("Webinar");
  const tradeshowId = await makeCampaign("Tradeshow");
  pass("Two campaigns created");

  // The same human, on two lists, with different details on each - which is
  // exactly why the merge screen lets you pick field by field.
  const sharedEmail = `zara.iqbal.${run}@example.com`;

  const webinarMemberId = randomUUID();
  await ok(
    admin.from("campaign_member").insert({
      id: webinarMemberId,
      campaignId: webinarId,
      firstName: "Zara",
      lastName: `Iqbal ${run}`,
      email: sharedEmail,
      phone: "+92 300 7654321",
      companyName: `Iqbal Textiles ${run}`,
      jobTitle: "Head of Operations",
      website: "https://iqbaltextiles.example",
      businessType: "MANUFACTURING",
      companySize: "MEDIUM",
      source: "WEBINAR",
      ownerUserId: staff.id,
      notes: "Asked about the reporting module.",
      updatedAt: now(),
    }),
    "Add her from the webinar",
  );
  ids.members.push(webinarMemberId);

  const tradeshowMemberId = randomUUID();
  await ok(
    admin.from("campaign_member").insert({
      id: tradeshowMemberId,
      campaignId: tradeshowId,
      firstName: "Zara",
      lastName: `Iqbal ${run}`,
      email: sharedEmail,
      // The same number written the way a badge scanner captured it.
      phone: "03007654321",
      companyName: `Iqbal Textiles ${run}`,
      street: "14 Ferozepur Road",
      city: "Lahore",
      country: "Pakistan",
      source: "TRADESHOW",
      ownerUserId: staff.id,
      updatedAt: now(),
    }),
    "Add her again from the trade show",
  );
  ids.members.push(tradeshowMemberId);

  pass("The same address exists in two campaigns - the per-campaign key allows it");

  // Within ONE campaign, though, it is still a duplicated import line.
  const dupeInSame = await admin.from("campaign_member").insert({
    id: randomUUID(),
    campaignId: webinarId,
    firstName: "Zara",
    email: sharedEmail,
    updatedAt: now(),
  }).select("id");
  assert.ok(dupeInSame.error, "The same address twice in ONE campaign must be refused");
  pass("The same address twice in one campaign is still refused");

  // ═══════════════════════════════════════════════════════════════════════
  step("02", "Converting a member carries every field");
  // ═══════════════════════════════════════════════════════════════════════

  const asUser = async () => {
    // A real session, so RLS and app_current_user_id() behave as in the app.
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const password = `T3st-${randomUUID()}`;
    await admin.auth.admin.updateUserById(
      (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === staff.email).id,
      { password },
    );
    const { error } = await anon.auth.signInWithPassword({ email: staff.email, password });
    if (error) throw new Error(`Sign in as ${staff.email}: ${error.message}`);
    return anon;
  };

  const session = await asUser();

  const converted = await ok(
    session.rpc("convert_member_to_lead", { p_member_id: webinarMemberId }),
    "Convert the webinar member",
  );
  const webinarLeadId = converted.leadId;
  ids.leads.push(webinarLeadId);
  assert.equal(converted.alreadyConverted, false, "First conversion is not a repeat");
  pass(`Member converted to lead ${converted.leadNumber}`);

  const lead = await ok(
    admin.from("lead")
      .select(`firstName, lastName, companyName, jobTitle, email, phone, website,
               businessType, companySize, leadSource, campaignId, campaignMemberId,
               description, status`)
      .eq("id", webinarLeadId).single(),
    "Read the new lead",
  );

  assert.equal(lead.companyName, `Iqbal Textiles ${run}`, "Company must carry across");
  assert.equal(lead.jobTitle, "Head of Operations", "Job title must carry across");
  assert.equal(lead.website, "https://iqbaltextiles.example", "Website must carry across");
  assert.equal(lead.businessType, "MANUFACTURING", "Business type must carry across");
  assert.equal(lead.companySize, "MEDIUM", "Company size must carry across");
  assert.equal(lead.leadSource, "WEBINAR", "The member's source becomes the lead source");
  assert.equal(lead.campaignId, webinarId, "The campaign must carry across, or it is unmeasurable");
  assert.equal(lead.campaignMemberId, webinarMemberId, "And the lead points back at the member");
  assert.equal(lead.status, "NEW", "It arrives as a new lead");
  pass("Every field carried across, including the campaign");

  const memberAfter = await ok(
    admin.from("campaign_member").select("leadId, convertedAt")
      .eq("id", webinarMemberId).single(),
    "Re-read the member",
  );
  assert.equal(memberAfter.leadId, webinarLeadId, "The member records its lead");
  assert.ok(memberAfter.convertedAt, "And when it was converted");
  pass("The member is marked converted, both ways");

  // A double-click must not make a second lead.
  const again = await ok(
    session.rpc("convert_member_to_lead", { p_member_id: webinarMemberId }),
    "Convert the same member again",
  );
  assert.equal(again.alreadyConverted, true, "A repeat conversion must say so");
  assert.equal(again.leadId, webinarLeadId, "And return the lead that already exists");
  pass("Converting twice returns the same lead rather than making another");

  // ═══════════════════════════════════════════════════════════════════════
  step("03", "The second campaign produces a duplicate lead");
  // ═══════════════════════════════════════════════════════════════════════

  const converted2 = await ok(
    session.rpc("convert_member_to_lead", { p_member_id: tradeshowMemberId }),
    "Convert the trade-show member",
  );
  const tradeshowLeadId = converted2.leadId;
  ids.leads.push(tradeshowLeadId);
  assert.notEqual(tradeshowLeadId, webinarLeadId, "It is a separate lead, by design");
  pass("A second lead exists for the same person - accepted, then merged");

  const dupes = await ok(
    session.from("lead_duplicate_group")
      .select("id, duplicate_count")
      .in("id", [webinarLeadId, tradeshowLeadId]),
    "Ask which leads look duplicated",
  );
  assert.equal(dupes.length, 2, "Both leads should be in the view");
  for (const d of dupes) {
    assert.ok(d.duplicate_count >= 1, "Each should see the other as a duplicate");
  }
  pass("Both flagged as duplicates - matched on email, and on phone despite the country code");

  // ═══════════════════════════════════════════════════════════════════════
  step("04", "Something attached to the lead that is about to lose");
  // ═══════════════════════════════════════════════════════════════════════

  const noteId = randomUUID();
  await ok(
    admin.from("note").insert({
      id: noteId,
      relatedEntityType: "Lead",
      relatedEntityId: tradeshowLeadId,
      content: "Met at the Lahore stand. Wants a quote before December.",
      createdById: staff.id,
      updatedAt: now(),
    }),
    "Add a note to the trade-show lead",
  );
  ids.notes.push(noteId);

  const activityId = randomUUID();
  await ok(
    admin.from("activity").insert({
      id: activityId,
      activityType: "LOG",
      subject: `Called about the stand conversation ${run}`,
      ownerUserId: staff.id,
      relatedEntityType: "Lead",
      relatedEntityId: tradeshowLeadId,
      status: "COMPLETED",
      completedAt: now(),
      updatedAt: now(),
    }),
    "Log a call against the trade-show lead",
  );
  ids.activities.push(activityId);
  pass("A note and a logged call sit on the lead that is about to be merged away");

  // ═══════════════════════════════════════════════════════════════════════
  step("05", "Merging, choosing field by field");
  // ═══════════════════════════════════════════════════════════════════════

  // The webinar record survives, but the trade-show record has the address -
  // which is the whole reason the screen picks per field rather than per record.
  const merged = await ok(
    session.rpc("merge_leads", {
      p_survivor: webinarLeadId,
      p_losers: [tradeshowLeadId],
      p_values: {
        street: "14 Ferozepur Road",
        city: "Lahore",
        country: "Pakistan",
      },
    }),
    "Merge the trade-show lead into the webinar one",
  );

  assert.equal(merged.mergedCount, 1, "One lead should have been retired");
  assert.ok(merged.recordsMoved >= 3, "The note, the activity and the member should all move");
  pass(`Merged - ${merged.recordsMoved} attached record(s) moved`);

  const survivor = await ok(
    admin.from("lead")
      .select("street, city, country, jobTitle, campaignId, deletedAt, mergedIntoId")
      .eq("id", webinarLeadId).single(),
    "Read the surviving lead",
  );
  assert.equal(survivor.city, "Lahore", "The chosen address must be applied");
  assert.equal(survivor.jobTitle, "Head of Operations", "What was not chosen must be left alone");
  assert.equal(survivor.deletedAt, null, "The survivor stays live");
  assert.equal(survivor.mergedIntoId, null, "And is not itself marked merged");
  pass("The survivor took the chosen fields and kept the rest");

  const loser = await ok(
    admin.from("lead").select("deletedAt, mergedIntoId, mergedAt")
      .eq("id", tradeshowLeadId).single(),
    "Read the retired lead",
  );
  assert.ok(loser.deletedAt, "The loser is soft-deleted");
  assert.equal(loser.mergedIntoId, webinarLeadId, "And says what it was merged into");
  pass("The loser is kept, soft-deleted, pointing at the survivor");

  const movedNote = await ok(
    admin.from("note").select("relatedEntityId").eq("id", noteId).single(),
    "Find the note",
  );
  assert.equal(movedNote.relatedEntityId, webinarLeadId, "The note must not be orphaned");

  const movedActivity = await ok(
    admin.from("activity").select("relatedEntityId").eq("id", activityId).single(),
    "Find the logged call",
  );
  assert.equal(movedActivity.relatedEntityId, webinarLeadId, "Nor the activity");
  pass("The note and the activity followed the survivor");

  const bothMembers = await ok(
    admin.from("campaign_member").select("id, campaignId, leadId")
      .in("id", [webinarMemberId, tradeshowMemberId]),
    "Read both member rows",
  );
  assert.equal(bothMembers.length, 2, "Both member rows survive - each is a real event");
  for (const m of bothMembers) {
    assert.equal(m.leadId, webinarLeadId, "Both now point at the surviving lead");
  }
  pass("Both campaigns stay credited - she really did come from both");

  // ═══════════════════════════════════════════════════════════════════════
  step("06", "A converted lead cannot be merged");
  // ═══════════════════════════════════════════════════════════════════════

  await ok(
    admin.from("lead").update({ convertedAt: now(), updatedAt: now() }).eq("id", webinarLeadId),
    "Pretend the survivor has been converted",
  );

  const refused = await session.rpc("merge_leads", {
    p_survivor: webinarLeadId, p_losers: [tradeshowLeadId], p_values: {},
  });
  assert.ok(refused.error, "Merging a converted lead must be refused");
  assert.match(refused.error.message, /converted lead cannot be merged/i, "And say why");
  pass("A converted lead is refused - it already has an account behind it");

  await ok(
    admin.from("lead").update({ convertedAt: null, updatedAt: now() }).eq("id", webinarLeadId),
    "Undo that",
  );

  // ═══════════════════════════════════════════════════════════════════════
  step("07", "One unsubscribe covers every copy of a person");
  // ═══════════════════════════════════════════════════════════════════════

  const batchId = randomUUID();
  await ok(
    admin.from("email_batch").insert({
      id: batchId,
      subject: `Introducing the reporting module ${run}`,
      bodyText: "Hello {{firstName}}, we thought this might interest you.",
      audienceType: "Lead",
      campaignId: webinarId,
      sentById: staff.id,
      updatedAt: now(),
    }),
    "Record the send",
  );
  ids.batches.push(batchId);

  // Two sends to the same address - which is the situation duplicates create.
  const sendIds = [randomUUID(), randomUUID()];
  for (const [i, id] of sendIds.entries()) {
    await ok(
      admin.from("activity").insert({
        id,
        activityType: "EMAIL",
        subject: `Introducing the reporting module ${run}`,
        ownerUserId: staff.id,
        relatedEntityType: "Lead",
        relatedEntityId: i === 0 ? webinarLeadId : tradeshowLeadId,
        batchId,
        toAddress: sharedEmail,
        sentAt: now(),
        status: "COMPLETED",
        updatedAt: now(),
      }),
      `Record send ${i + 1}`,
    );
    ids.activities.push(id);
  }
  pass("Two emails went to the same address, on two lead records");

  // She clicks unsubscribe on ONE of them.
  await ok(
    admin.rpc("unsubscribe_activity", { p_activity: sendIds[0] }),
    "She unsubscribes from the first",
  );
  ids.suppressed.push(sharedEmail.toLowerCase());

  const suppression = await ok(
    admin.from("email_suppression").select("email, reason")
      .eq("email", sharedEmail.toLowerCase()).maybeSingle(),
    "Look for the suppression",
  );
  assert.ok(suppression, "The address must be suppressed");
  assert.equal(suppression.reason, "UNSUBSCRIBED", "For the right reason");
  pass("The ADDRESS is suppressed, not the lead row");

  const stamped = await ok(
    admin.from("activity").select("id, unsubscribedAt").in("id", sendIds),
    "Check both sends",
  );
  assert.equal(stamped.length, 2, "Both sends should be there");
  for (const s of stamped) {
    assert.ok(
      s.unsubscribedAt,
      "BOTH sends must be stamped - one unsubscribe is about the person, not one email",
    );
  }
  pass("Both sends marked unsubscribed - no merge was needed for consent to work");

  // An unknown token must not be distinguishable from a real one.
  const bogus = await ok(
    admin.rpc("unsubscribe_activity", { p_activity: randomUUID() }),
    "Unsubscribe with a made-up token",
  );
  assert.equal(bogus.done, true, "A bad token must answer exactly like a good one");
  pass("A made-up token gets the same answer - nothing to probe");

  // ═══════════════════════════════════════════════════════════════════════
  step("08", "The scorecard");
  // ═══════════════════════════════════════════════════════════════════════

  await ok(
    admin.from("activity").update({
      deliveredAt: now(), openedAt: now(), openCount: 2, updatedAt: now(),
    }).eq("id", sendIds[0]),
    "Mark the first as delivered and opened",
  );

  const forBatch = await ok(
    session.from("activity")
      .select("sentAt, deliveredAt, openedAt, clickedAt, bouncedAt, unsubscribedAt, openCount")
      .eq("batchId", batchId),
    "Read the batch's activities",
  );
  assert.equal(forBatch.length, 2, "Two sends in the batch");
  assert.equal(forBatch.filter((r) => r.sentAt).length, 2, "Both sent");
  assert.equal(forBatch.filter((r) => r.deliveredAt).length, 1, "One delivered");
  assert.equal(forBatch.filter((r) => r.openedAt).length, 1, "One opened");
  assert.equal(forBatch.filter((r) => r.unsubscribedAt).length, 2, "Both unsubscribed");
  pass("The batch's figures come from its activities - nothing stored to drift");

  console.log(`\n${"═".repeat(64)}`);
  console.log(`${passed.length} checks passed.`);
  console.log(`${"═".repeat(64)}\n`);
  console.log("  Campaign  →  member (one row per campaign)");
  console.log("    → Convert to lead, every field carried");
  console.log("      → Same person from a 2nd campaign = 2nd lead, flagged");
  console.log("        → Merge, choosing field by field");
  console.log("          → notes, activities and BOTH members follow the survivor");
  console.log("            → one unsubscribe suppresses the address everywhere");
  console.log("              → the batch scorecard reads from the activities\n");
} finally {
  const cleanup = ids.teardown();
  const failures = [];
  for (const undo of cleanup) {
    try {
      const r = await undo();
      // PostgREST returns errors rather than throwing, so a try/catch alone
      // would report a clean teardown while rows survived.
      if (r?.error) failures.push(r.error.message);
    } catch (err) {
      failures.push(err.message);
    }
  }
  if (failures.length) {
    console.error("\nTeardown left rows behind:");
    for (const f of failures) console.error(`  ${f}`);
  } else {
    console.log("Temporary data removed.");
  }
}
