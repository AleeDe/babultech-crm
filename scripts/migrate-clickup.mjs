/**
 * Replaces the demo CRM with the real ClickUp workspace data.
 *
 * Full wipe: every business row is deleted, app_user and auth.users included,
 * then identity is rebuilt from the five ClickUp workspace members. Run
 * scripts/backup-before-clickup.mjs first — this is not reversible without it.
 *
 * ClickUp only holds two real datasets. The sales pipeline lists (Accounts,
 * Contacts, Opportunities, Prospects, Campaigns, Revenue) are all empty, so the
 * matching CRM tables end up empty too:
 *
 *   1. Finance / 2026 Expenses  ->  expense            (13 rows)
 *   2. Products + Projects      ->  project + project_task
 *
 * The products are BabulTech's own, not customer work, so a single internal
 * account owns every project — project.accountId is NOT NULL and there is no
 * customer to point it at.
 *
 * Order matters. Lookup data (roles, department, currency, sequences,
 * categories) is preserved rather than deleted: it is configuration, not demo
 * content, and the new rows depend on it.
 *
 * scripts/clickup-export.json is NOT in git: it holds real task data including
 * personal email addresses. Re-fetch it before running this — page through
 * /api/v2/team/<team>/task with subtasks=true and include_closed=true using a
 * ClickUp personal token, and write the concatenated `tasks` arrays to
 * scripts/clickup-export.json.
 *
 * Run: node scripts/migrate-clickup.mjs [--yes]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const PASSWORD = process.env.SEED_PASSWORD ?? "BabulTech@2026";

// Supabase Auth verifies the password now, so this hash is not on the sign-in
// path. It is still written because app_user.passwordHash is a legacy column
// other tooling reads, and an empty value there reads as a broken account.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 10);

const tasks = JSON.parse(readFileSync("scripts/clickup-export.json", "utf8"));

function fail(label, error) {
  if (error) {
    console.error(`\n  x ${label}: ${error.message}\n`);
    process.exit(1);
  }
}

const now = () => new Date().toISOString();
const dateOnly = (ms) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : null);

// ---------------------------------------------------------------- confirm

if (!process.argv.includes("--yes")) {
  console.error(
    "\nThis DELETES every CRM row including all logins, then rebuilds from ClickUp.\n" +
      "Take a backup first (node scripts/backup-before-clickup.mjs), then re-run with --yes\n",
  );
  process.exit(1);
}

// ---------------------------------------------------------------- 1. wipe

// Children before parents: no ON DELETE CASCADE is declared, so a parent-first
// delete trips its foreign keys.
const WIPE_ORDER = [
  "sla_timer_event", "case_comment", "support_case", "case_category",
  "campaign_member", "campaign", "campaign_type",
  "training_participant", "training",
  "vendor_payment_allocation", "vendor_payment", "vendor_bill_line", "vendor_bill",
  "payment_allocation", "payment", "invoice_line", "invoice",
  "commission_payout", "commission_record", "commission_tier", "commission_plan",
  "quote_line", "quotation",
  "opportunity_product", "opportunity_partner", "opportunity",
  "time_log", "expense", "financial_transaction",
  "project_issue", "project_risk", "project_task", "project_member",
  "milestone", "project_phase", "change_request", "project",
  "contract", "document", "email", "note", "activity", "audit_history",
  "approval_step", "approval_request",
  "knowledge_article", "lead",
  "partner_contact", "partner",
  "contact", "account",
  "team_member", "product",
];

console.log("\nWiping demo data...");
for (const table of WIPE_ORDER) {
  const { error } = await db.from(table).delete().not("id", "is", null);
  fail(`wipe ${table}`, error);
}
console.log(`  - cleared ${WIPE_ORDER.length} tables`);

// ---------------------------------------------------------------- 2. identity

// The five ClickUp workspace members, plus Akbar Ali who is assigned tasks but
// is not a member. Roles reuse the existing security_role rows.
const { data: roles } = await db.from("security_role").select("id,name");
const roleId = (name) => roles.find((r) => r.name === name).id;

const { data: depts } = await db.from("department").select("id");
const departmentId = depts[0]?.id ?? null;

const PEOPLE = [
  { email: "babul.tech786@gmail.com",         fullName: "Babul Tech",       role: "Administrator",   num: "EMP-001" },
  { email: "sammiiiullah@gmail.com",          fullName: "Sami Ullah",       role: "Project Manager", num: "EMP-002" },
  { email: "muhammadali.abidi1416@gmail.com", fullName: "Muhammad Ali",     role: "Consultant",      num: "EMP-003" },
  { email: "mh1915727@gmail.com",             fullName: "Muhammad Hussain", role: "Consultant",      num: "EMP-004" },
  { email: "akbarali1512141@gmail.com",       fullName: "Akbar Ali",        role: "Consultant",      num: "EMP-005" },
  { email: "shabbirwrites14125@gmail.com",    fullName: "Shabbir Writes",   role: "Consultant",      num: "EMP-006" },
  // Hassan Shamsi pays the office expenses. ClickUp spells him both "Hassan
  // Shamsi" (Expense By) and "Hasan Shamsi" (Who Paid); one row here, matching
  // the spelling the old admin profile used.
  { email: "hassan.shamsi@babultech.com",     fullName: "Hassan Shamsi",    role: "Finance",         num: "EMP-007" },
];

// auth.users is wiped only after the new app_user rows are ready, so a failure
// before this point still leaves the old logins working.
const { data: oldAuth } = await db.auth.admin.listUsers({ perPage: 1000 });

const { error: delUsersErr } = await db.from("app_user").delete().not("id", "is", null);
fail("wipe app_user", delUsersErr);

for (const u of oldAuth?.users ?? []) {
  await db.auth.admin.deleteUser(u.id);
}
console.log(`  - removed ${oldAuth?.users?.length ?? 0} old logins`);

const userByEmail = new Map();

for (const p of PEOPLE) {
  const id = randomUUID();
  const { error } = await db.from("app_user").insert({
    id,
    employeeNumber: p.num,
    fullName: p.fullName,
    email: p.email,
    passwordHash: PASSWORD_HASH,
    departmentId,
    roleId: roleId(p.role),
    status: "ACTIVE",
    createdAt: now(),
    updatedAt: now(),
  });
  fail(`app_user ${p.email}`, error);

  // Same id on both sides, so every ownerUserId/createdById FK stays valid.
  const { error: authErr } = await db.auth.admin.createUser({
    id,
    email: p.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: p.fullName },
  });
  fail(`auth user ${p.email}`, authErr);

  userByEmail.set(p.email, id);
  console.log(`  + ${p.email} (${p.role})`);
}

const adminId = userByEmail.get("babul.tech786@gmail.com");
const financeId = userByEmail.get("hassan.shamsi@babultech.com");

// Team membership drives TEAM-scope visibility. Everyone who works on the
// products joins the delivery team; Shabbir (marketing) and Hassan (finance)
// stay out, so TEAM scope is provably narrower than the whole company.
const { data: teamRows } = await db.from("team").select("id").limit(1);
const teamId = teamRows?.[0]?.id;

if (teamId) {
  const DELIVERY = [
    "babul.tech786@gmail.com",
    "sammiiiullah@gmail.com",
    "muhammadali.abidi1416@gmail.com",
    "mh1915727@gmail.com",
    "akbarali1512141@gmail.com",
  ];
  for (const email of DELIVERY) {
    const { error } = await db.from("team_member").insert({
      id: randomUUID(),
      teamId,
      userId: userByEmail.get(email),
      createdAt: now(),
      updatedAt: now(),
    });
    fail(`team_member ${email}`, error);
  }
  console.log(`  - delivery team: ${DELIVERY.length} members`);
}

// ---------------------------------------------------------------- 3. account

// One internal account. Every product project hangs off it because
// project.accountId is NOT NULL and these are BabulTech's own products.
const accountId = randomUUID();
fail("account", (await db.from("account").insert({
  id: accountId,
  accountNumber: "ACC-0001",
  name: "BabulTech (Internal)",
  accountType: "OTHER",
  ownerUserId: adminId,
  industry: "Software",
  description: "Internal account owning BabulTech's own product development. Created by the ClickUp migration.",
  createdAt: now(),
  updatedAt: now(),
}).select()).error);
console.log("\n  + account: BabulTech (Internal)");

// ---------------------------------------------------------------- 4. projects

// Each ClickUp product/project list becomes one project. The template folder is
// scaffolding for duplicating, not real work, so it is skipped.
const SKIP_FOLDER = "🧩 TEMPLATE — New Product (duplicate me)";

const listGroups = new Map();
for (const t of tasks) {
  if (!t.list || !t.folder) continue;
  if (t.folder.name === SKIP_FOLDER) continue;
  if (t.folder.name === "Expenses") continue;
  if (!listGroups.has(t.list.id)) {
    listGroups.set(t.list.id, { name: t.list.name, folder: t.folder.name, tasks: [] });
  }
  listGroups.get(t.list.id).tasks.push(t);
}

// ClickUp status -> TaskStatus. Anything unrecognised falls back by status type.
const TASK_STATUS = {
  "to do": "NOT_STARTED",
  "idea": "NOT_STARTED",
  "in progress": "IN_PROGRESS",
  "support": "IN_PROGRESS",
  "complete": "COMPLETED",
  "completed": "COMPLETED",
  "cancelled": "CANCELLED",
};

const projectIdByList = new Map();
let projectSeq = 1;
let taskCount = 0;

for (const [listId, group] of listGroups) {
  const done = group.tasks.filter((t) => t.status.type === "closed" || t.status.type === "done").length;
  const percent = group.tasks.length ? Math.round((done / group.tasks.length) * 100) : 0;

  // Earliest created and latest due date bound the project window.
  const created = group.tasks.map((t) => Number(t.date_created)).filter(Boolean);
  const dues = group.tasks.map((t) => Number(t.due_date)).filter(Boolean);

  const projectId = randomUUID();
  const { error } = await db.from("project").insert({
    id: projectId,
    projectNumber: `PRJ-${String(projectSeq).padStart(4, "0")}`,
    name: group.name,
    accountId,
    projectManagerId: adminId,
    status: percent === 100 ? "COMPLETED" : percent > 0 ? "ACTIVE" : "PLANNING",
    health: "GREEN",
    billingType: "FIXED",
    startDate: created.length ? dateOnly(Math.min(...created)) : null,
    plannedEndDate: dues.length ? dateOnly(Math.max(...dues)) : null,
    completionPercent: percent,
    currencyCode: "PKR",
    scope: `Imported from ClickUp: ${group.folder} / ${group.name}`,
    createdAt: now(),
    updatedAt: now(),
  });
  fail(`project ${group.name}`, error);
  projectIdByList.set(listId, projectId);
  projectSeq += 1;

  // Subtasks reference a parent that must already exist, so parents insert
  // first and the child pass resolves parentTaskId from this map.
  const idByClickUp = new Map();
  const ordered = [...group.tasks].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0));

  for (const t of ordered) {
    const id = randomUUID();
    idByClickUp.set(t.id, id);

    const assignee = t.assignees?.[0]?.email;
    const status =
      TASK_STATUS[t.status.status.toLowerCase()] ??
      (t.status.type === "closed" || t.status.type === "done" ? "COMPLETED" : "NOT_STARTED");

    const { error: taskErr } = await db.from("project_task").insert({
      id,
      projectId,
      parentTaskId: t.parent ? idByClickUp.get(t.parent) ?? null : null,
      name: t.name.slice(0, 255),
      description: t.text_content || t.description || null,
      assignedUserId: (assignee && userByEmail.get(assignee)) || null,
      status,
      priority: t.priority?.priority
        ? { urgent: "CRITICAL", high: "HIGH", normal: "MEDIUM", low: "LOW" }[t.priority.priority] ?? "MEDIUM"
        : "MEDIUM",
      startDate: dateOnly(t.start_date),
      dueDate: dateOnly(t.due_date),
      completedDate: dateOnly(t.date_done ?? t.date_closed),
      estimatedHours: t.time_estimate ? Number(t.time_estimate) / 3600000 : null,
      completionPercent: status === "COMPLETED" ? 100 : 0,
      billable: false,
      createdAt: t.date_created ? new Date(Number(t.date_created)).toISOString() : now(),
      updatedAt: now(),
    });
    fail(`project_task ${t.name}`, taskErr);
    taskCount += 1;
  }

  console.log(`  + ${group.name}: ${group.tasks.length} tasks, ${percent}% done`);
}

// ---------------------------------------------------------------- 5. expenses

// ClickUp expense types map onto the existing expense_category rows. Utilities
// and Hardware both land in Office & Supplies — the schema has no closer match.
const { data: cats } = await db.from("expense_category").select("id,name");
const catId = (name) => cats.find((c) => c.name === name).id;

const CATEGORY = {
  Utilities: "Office & Supplies",
  Hardware: "Office & Supplies",
  Transportation: "Travel",
  Internet: "Office & Supplies",
  Software: "Software & Licences",
};

const expenseTasks = tasks.filter((t) => t.list?.name === "2026 Expenses");
const flagged = [];
let expenseSeq = 1;

console.log("\nExpenses:");

for (const t of expenseTasks) {
  const f = {};
  for (const c of t.custom_fields ?? []) {
    let v = c.value;
    if (v == null || v === "") continue;
    if (c.type === "drop_down" && c.type_config?.options) {
      const o = c.type_config.options.find((o) => o.id === v || o.orderindex === v);
      v = o ? o.name : v;
    }
    f[c.name] = v;
  }

  const amount = Number(f["Total Amount"] ?? f["Amount"] ?? 0);
  const type = f["Expense Type"];

  // amount is NOT NULL. Two ClickUp rows never had one filled in, so they load
  // at zero in DRAFT and are listed at the end for you to complete.
  if (!amount) flagged.push(t.name);

  const { error } = await db.from("expense").insert({
    id: randomUUID(),
    expenseNumber: `EXP-${String(expenseSeq).padStart(4, "0")}`,
    employeeUserId: financeId,
    categoryId: catId(CATEGORY[type] ?? "Office & Supplies"),
    expenseDate: dateOnly(f["Expense Date"]) ?? dateOnly(t.date_created),
    description: t.name,
    amount: amount.toFixed(2),
    currencyCode: "PKR",
    billableToCustomer: false,
    reimbursable: true,
    approvalStatus: amount ? "SUBMITTED" : "DRAFT",
    paymentStatus: "UNPAID",
    createdAt: now(),
    updatedAt: now(),
  });
  fail(`expense ${t.name}`, error);
  expenseSeq += 1;
  console.log(`  + ${t.name}: PKR ${amount.toLocaleString()}`);
}

const total = expenseTasks.reduce((s, t) => {
  const c = (t.custom_fields ?? []).find((c) => c.name === "Total Amount");
  return s + Number(c?.value ?? 0);
}, 0);

console.log(`\n  Total: PKR ${total.toLocaleString()} across ${expenseTasks.length} expenses`);
if (flagged.length) {
  console.log(`\n  Needs an amount (loaded as 0, DRAFT):`);
  flagged.forEach((n) => console.log(`    ! ${n}`));
}

console.log(
  `\nDone. ${projectIdByList.size} projects, ${taskCount} tasks, ${expenseTasks.length} expenses, ` +
    `${PEOPLE.length} users.\nLogin: babul.tech786@gmail.com / ${PASSWORD}\n`,
);
