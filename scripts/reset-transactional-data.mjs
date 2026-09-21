// Clears the transactional data and leaves the shape of the system standing.
//
// Kept: the standalone projects and their tasks, the standalone
// expense claims, the staff logins, and every reference list -
// expense categories, campaign types, currencies, tax rates, SLA policies,
// business hours, departments, roles, number sequences, commission plans,
// picklists.
//
// Removed: accounts, contacts, leads, campaigns, opportunities, quotations,
// contracts, products, price books, cases, invoices, payments, vendor bills,
// partners, commission, the partner conversation, activities, notes, documents,
// emails, both portal logins, and everything the walkthrough left behind -
// including its project and expense, which link to records that are going.
//
// This is a SHARED database. Run it only when the people using it expect it.
//
// Usage: node scripts/reset-transactional-data.mjs --dry-run
//        node scripts/reset-transactional-data.mjs --confirm
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env", quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const mode = process.argv[2];
const dryRun = mode !== "--confirm";

if (!["--dry-run", "--confirm"].includes(mode ?? "")) {
  console.error("Say --dry-run to see what would go, or --confirm to do it.");
  process.exit(1);
}

/** Staff logins are kept; everything @example.com or portal-linked is not. */
const KEEP_EMAIL_DOMAIN = "@babultech.com";

let removed = 0;
const failures = [];
const plan = [];

async function countOf(table, build) {
  const q = build(db.from(table).select("id", { count: "exact", head: true }));
  const { count, error } = await q;
  return error ? 0 : (count ?? 0);
}

/** Everything in a table. `build` narrows it where only part should go. */
async function clear(table, label, build = (q) => q) {
  if (dryRun) {
    const n = await countOf(table, build);
    if (n) plan.push([n, label ?? table]);
    return;
  }
  const { data, error } = await build(db.from(table).delete()).select("id");
  if (error) {
    failures.push(`${label ?? table}: ${error.message}`);
    return;
  }
  if (data?.length) {
    removed += data.length;
    console.log(`  removed ${String(data.length).padStart(4)}  ${label ?? table}`);
  }
}

/** A delete with no filter needs one PostgREST will accept. */
const all = (q) => q.not("id", "is", null);

console.log(dryRun ? "DRY RUN - nothing will be deleted\n" : "Clearing transactional data\n");

// --- work out which projects and expenses are entangled --------------------
//
// A project that points at an account or opportunity cannot outlive them, and a
// project with nothing attached is an internal one worth keeping. Same for an
// expense booked to a project that is going.
const { data: allProjects } = await db
  .from("project")
  .select("id, projectNumber, accountId, opportunityId");
const doomedProjects = (allProjects ?? [])
  .filter((p) => p.accountId || p.opportunityId)
  .map((p) => p.id);

const { data: allExpenses } = await db.from("expense").select("id, expenseNumber, projectId");
const doomedExpenses = (allExpenses ?? [])
  .filter((e) => e.projectId && doomedProjects.includes(e.projectId))
  .map((e) => e.id);

const keptProjects = (allProjects ?? []).length - doomedProjects.length;
const keptExpenses = (allExpenses ?? []).length - doomedExpenses.length;

const inDoomed = (column) => (q) =>
  doomedProjects.length ? q.in(column, doomedProjects) : q.eq(column, "00000000-0000-0000-0000-000000000000");

// --- money ------------------------------------------------------------------
await clear("payment_allocation", "payment allocations", all);
await clear("payment", "payments", all);
await clear("invoice_line", "invoice lines", all);
await clear("invoice", "invoices", all);
await clear("vendor_payment_allocation", "vendor payment allocations", all);
await clear("vendor_payment", "vendor payments", all);
await clear("vendor_bill_line", "vendor bill lines", all);
await clear("vendor_bill", "vendor bills", all);
await clear("financial_transaction", "financial transactions", all);
// accounting_period_lock and project_content_plan key on something other than
// id, so the generic clear cannot report on them. Both are empty and neither
// is transactional in the sense meant here.

// --- partner surface --------------------------------------------------------
await clear("partner_message_attachment", "message attachments", all);
await clear("partner_message", "partner messages", all);
await clear("commission_proposal", "rate requests", all);
await clear("commission_payout", "commission payouts", all);
await clear("commission_record", "commission records", all);
await clear("opportunity_partner", "deal-partner links", all);
await clear("partner_contact", "partner contact links", all);

// --- delivery, but only what is entangled -----------------------------------
await clear("expense", "expenses on a doomed project", (q) =>
  doomedExpenses.length ? q.in("id", doomedExpenses) : q.eq("id", "00000000-0000-0000-0000-000000000000"),
);
await clear("time_log", "time logs on a doomed project", inDoomed("projectId"));
await clear("project_task", "tasks on a doomed project", inDoomed("projectId"));
await clear("project_member", "members of a doomed project", inDoomed("projectId"));
await clear("project_risk", "risks on a doomed project", inDoomed("projectId"));
await clear("project_issue", "issues on a doomed project", inDoomed("projectId"));
await clear("change_request", "change requests on a doomed project", inDoomed("projectId"));
await clear("milestone", "milestones on a doomed project", inDoomed("projectId"));
await clear("project_phase", "phases of a doomed project", inDoomed("projectId"));
await clear("project", "projects linked to a customer", (q) =>
  doomedProjects.length ? q.in("id", doomedProjects) : q.eq("id", "00000000-0000-0000-0000-000000000000"),
);

// Time logged against a case, which is going either way.
await clear("time_log", "time logs on cases", (q) => q.not("caseId", "is", null));

// --- service ----------------------------------------------------------------
await clear("sla_timer_event", "SLA events", all);
await clear("case_comment", "case comments", all);
await clear("support_case", "support cases", all);

// --- content ----------------------------------------------------------------
await clear("client_review_link", "client review links", all);
await clear("content_publication", "content publications", all);
await clear("content_review", "content reviews", all);
await clear("content_version", "content versions", all);


// --- sales ------------------------------------------------------------------
await clear("quote_line", "quote lines", all);
await clear("quotation", "quotations", all);
await clear("contract", "contracts", all);
await clear("opportunity_product", "deal products", all);
await clear("opportunity", "opportunities", all);
await clear("delivery_handoff", "delivery handoffs", all);
await clear("lead_handoff", "lead handoffs", all);
await clear("lead", "leads", all);
await clear("campaign_member", "campaign members", all);
await clear("campaign", "campaigns", all);

// --- catalogue (kept: none of it is reference data we agreed to keep) --------
await clear("price_book", "price books", all);
await clear("product_option", "product options", all);
await clear("product", "products", all);

// --- shared -----------------------------------------------------------------
await clear("note_mention", "note mentions", all);
await clear("note_attachment", "note attachments", all);
await clear("note", "notes", all);
await clear("activity", "activities", all);
await clear("document", "documents", all);
await clear("email", "emails", all);
await clear("approval_step", "approval steps", all);
await clear("approval_request", "approval requests", all);

// --- portal and test logins, before the records they point at ---------------
//
// A PARTNER or CUSTOMER login must name the partner or contact it belongs to,
// so it has to go first; deleting the contact underneath it would trip that
// check instead.
const { data: goingUsers } = await db
  .from("app_user")
  .select("id, email, fullName, userType")
  .or(`userType.neq.INTERNAL,email.not.like.*${KEEP_EMAIL_DOMAIN}`);

if (dryRun) {
  if (goingUsers?.length) plan.push([goingUsers.length, "logins (portal and test)"]);
} else {
  let gone = 0;
  for (const user of goingUsers ?? []) {
    const { error } = await db.from("app_user").delete().eq("id", user.id);
    if (error) {
      failures.push(`login ${user.email}: ${error.message}`);
      continue;
    }
    const auth = await db.auth.admin.deleteUser(user.id);
    if (auth.error && !/not found/i.test(auth.error.message)) {
      failures.push(`auth ${user.email}: ${auth.error.message}`);
    }
    gone += 1;
  }
  if (gone) {
    removed += gone;
    console.log(`  removed ${String(gone).padStart(4)}  logins (portal and test)`);
  }
}

// --- partners, contacts, accounts -------------------------------------------
await clear("partner", "partners", all);
await clear("contact", "contacts", all);
await clear("account", "accounts", all);

// --- logins, second pass ----------------------------------------------------
//
// A login that owned an account could not go on the first pass, because the
// account named it. The accounts are gone now, so it can.
if (!dryRun) {
  const { data: stragglers } = await db
    .from("app_user")
    .select("id, email")
    .or(`userType.neq.INTERNAL,email.not.like.*${KEEP_EMAIL_DOMAIN}`);
  let gone = 0;
  for (const user of stragglers ?? []) {
    const { error } = await db.from("app_user").delete().eq("id", user.id);
    if (error) { failures.push(`login ${user.email}: ${error.message}`); continue; }
    const auth = await db.auth.admin.deleteUser(user.id);
    if (auth.error && !/not found/i.test(auth.error.message)) {
      failures.push(`auth ${user.email}: ${auth.error.message}`);
    }
    gone += 1;
  }
  if (gone) { removed += gone; console.log(`  removed ${String(gone).padStart(4)}  logins held by an account`); }
}

// --- report -----------------------------------------------------------------
if (dryRun) {
  console.log("Would remove:\n");
  for (const [n, label] of plan) console.log(`  ${String(n).padStart(4)}  ${label}`);
  console.log(`\n  ${plan.reduce((s, [n]) => s + n, 0)} rows in total.`);
  console.log("\nWould keep:\n");
  console.log(`  ${String(keptProjects).padStart(4)}  projects, with their tasks and members`);
  console.log(`  ${String(keptExpenses).padStart(4)}  expense claims`);

  const { count: staff } = await db
    .from("app_user")
    .select("id", { count: "exact", head: true })
    .eq("userType", "INTERNAL")
    .like("email", `%${KEEP_EMAIL_DOMAIN}`);
  console.log(`  ${String(staff ?? 0).padStart(4)}  staff logins`);
  console.log("        every reference list (categories, currencies, roles, picklists, plans)");
  console.log("\nRun again with --confirm to do it.");
} else {
  console.log(`\n${removed} rows removed.`);
  console.log(`Kept ${keptProjects} projects, ${keptExpenses} expense claims, and the staff logins.`);
  if (failures.length) {
    console.log("\nThese did not delete:");
    for (const f of failures) console.log(`  ${f}`);
    process.exitCode = 1;
  }
}
