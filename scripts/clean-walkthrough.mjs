// Removes what seed-walkthrough.mjs left behind.
//
// With a tag, it removes that run. With --all, every run: everything the
// walkthrough makes is named "WT ..." or numbered "WT-...", and the logins it
// creates are @example.com addresses beginning "wt-", so both are findable
// without keeping a manifest.
//
// Deletion order follows the foreign keys inwards: children before parents,
// and the money before the records it hangs off. A row that will not delete is
// reported rather than swallowed, because a walkthrough record left behind is
// better than a silent half-deletion.
//
// Usage: node scripts/clean-walkthrough.mjs <TAG>
//        node scripts/clean-walkthrough.mjs --all
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env", quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const arg = process.argv[2];
if (!arg) {
  console.error("Say which run to remove: a tag, or --all");
  process.exit(1);
}
const all = arg === "--all";
const tag = all ? null : arg.toUpperCase();
const like = all ? "WT %" : `WT %${tag}%`;
const numberLike = all ? "WT-%" : `WT-%${tag}`;

let removed = 0;
const failures = [];

async function wipe(table, column, pattern, label) {
  const { data, error } = await db
    .from(table)
    .delete()
    .like(column, pattern)
    .select("id");
  if (error) {
    failures.push(`${label ?? table}: ${error.message}`);
    return;
  }
  if (data?.length) {
    removed += data.length;
    console.log(`  removed ${String(data.length).padStart(3)}  ${label ?? table}`);
  }
}

/** Delete rows of `table` whose `column` matches ids from another query. */
async function wipeBy(table, column, ids, label) {
  if (!ids.length) return;
  const { data, error } = await db.from(table).delete().in(column, ids).select("id");
  if (error) {
    failures.push(`${label ?? table}: ${error.message}`);
    return;
  }
  if (data?.length) {
    removed += data.length;
    console.log(`  removed ${String(data.length).padStart(3)}  ${label ?? table}`);
  }
}

async function idsOf(table, column, pattern) {
  const { data } = await db.from(table).select("id").like(column, pattern);
  return (data ?? []).map((r) => r.id);
}

console.log(all ? "Removing every walkthrough run\n" : `Removing walkthrough run ${tag}\n`);

// --- gather the anchors first, before anything is deleted -------------------
const accounts = await idsOf("account", "name", like);
const partners = await idsOf("partner", "displayName", like);
const projects = await idsOf("project", "name", like);
const opportunities = await idsOf("opportunity", "name", like);
const invoices = await idsOf("invoice", "invoiceNumber", numberLike);
const payments = await idsOf("payment", "paymentNumber", numberLike);
const cases = await idsOf("support_case", "caseNumber", numberLike);
const quotations = await idsOf("quotation", "quoteNumber", numberLike);

// --- money, innermost first -------------------------------------------------
await wipeBy("payment_allocation", "paymentId", payments, "payment allocations");
await wipeBy("payment", "id", payments, "payments");
await wipeBy("invoice_line", "invoiceId", invoices, "invoice lines");
await wipeBy("invoice", "id", invoices, "invoices");
await wipe("expense", "expenseNumber", numberLike, "expense claims");

// --- partner surface --------------------------------------------------------
await wipeBy("partner_message_attachment", "messageId",
  (await db.from("partner_message").select("id").in("partnerId", partners.length ? partners : ["00000000-0000-0000-0000-000000000000"])).data?.map((r) => r.id) ?? [],
  "message attachments");
await wipeBy("partner_message", "partnerId", partners, "partner messages");
await wipeBy("commission_proposal", "partnerId", partners, "rate requests");
await wipeBy("commission_record", "partnerId", partners, "commission records");
await wipeBy("opportunity_partner", "partnerId", partners, "deal-partner links");
await wipeBy("partner_contact", "partnerId", partners, "partner contact links");

// --- delivery ---------------------------------------------------------------
await wipeBy("time_log", "projectId", projects, "time logs");
await wipeBy("project_task", "projectId", projects, "project tasks");
await wipeBy("project_member", "projectId", projects, "project members");
await wipeBy("project", "id", projects, "projects");

// --- service ----------------------------------------------------------------
await wipeBy("case_comment", "caseId", cases, "case comments");
await wipeBy("support_case", "id", cases, "support cases");

// --- sales ------------------------------------------------------------------
await wipeBy("quote_line", "quotationId", quotations, "quote lines");
await wipeBy("quotation", "id", quotations, "quotations");
await wipeBy("opportunity_partner", "opportunityId", opportunities, "deal-partner links");
await wipeBy("opportunity", "id", opportunities, "deals");
await wipe("lead", "leadNumber", numberLike, "leads");
await wipe("campaign", "campaignNumber", numberLike, "campaigns");

// --- catalogue --------------------------------------------------------------
await wipe("price_book", "name", like, "price books");
await wipe("product", "name", like, "products");

// --- logins, first pass: the external ones ----------------------------------
const emailLike = all ? "wt-%@example.com" : `wt-%${tag.toLowerCase()}@example.com`;

async function removeLogins(kinds, label) {
  let query = db.from("app_user").select("id, email").like("email", emailLike);
  if (kinds) query = query.in("userType", kinds);
  const { data: users } = await query;
  let gone = 0;
  for (const user of users ?? []) {
    const { error } = await db.from("app_user").delete().eq("id", user.id);
    if (error) {
      failures.push(`app_user ${user.email}: ${error.message}`);
      continue;
    }
    const auth = await db.auth.admin.deleteUser(user.id);
    // The walkthrough removes its own temporary administrator as it finishes,
    // so its sign-in is often already gone. That is the tidy case, not a
    // failure, and reporting it as one would bury the real ones.
    if (auth.error && !/not found/i.test(auth.error.message)) {
      failures.push(`auth ${user.email}: ${auth.error.message}`);
    }
    gone += 1;
  }
  if (gone) {
    removed += gone;
    console.log(`  removed ${String(gone).padStart(3)}  ${label}`);
  }
}

await removeLogins(["PARTNER", "CUSTOMER"], "portal logins");

// --- partners and customers -------------------------------------------------
await wipeBy("partner", "id", partners, "partners");
await wipeBy("contact", "accountId", accounts, "contacts");
await wipeBy("account", "id", accounts, "accounts");

// --- logins, second pass: the staff -----------------------------------------
await removeLogins(null, "staff logins");

console.log(`\n${removed} rows removed.`);
if (failures.length) {
  console.log("\nThese did not delete, and are still there:");
  for (const f of failures) console.log(`  ${f}`);
  process.exitCode = 1;
}
