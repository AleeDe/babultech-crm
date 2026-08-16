/**
 * Minimal cloud seed via supabase-js.
 *
 * Seeds the identity data the app cannot start without — roles, department,
 * team, users, number sequences — using the service-role client rather than
 * Prisma, so it runs without a database password.
 *
 * The demo CRM data — accounts, opportunities, quotations, partners,
 * commission — lives in scripts/seed-demo.mjs and runs after this one.
 *
 * Idempotent: every write is an upsert keyed on a natural unique column.
 *
 * Run: node scripts/seed-cloud.mjs
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";

config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

// Service role: RLS is bypassed. Correct here — seeding is an admin operation
// that must write rows no user could see.
const db = createClient(url, key, { auth: { persistSession: false } });

const PASSWORD = "BabulTech@2026";

function fail(label, error) {
  if (error) {
    console.error(`  x ${label}: ${error.message}`);
    process.exit(1);
  }
}

async function upsert(table, rows, onConflict) {
  // Prisma fills several columns client-side, so they have no database default:
  //   id        — @default(uuid())
  //   updatedAt — @updatedAt
  // Going direct to PostgREST means supplying them here. This is the single
  // most common failure when porting Prisma writes to supabase-js.
  const now = new Date().toISOString();
  const withIds = rows.map((r) => ({ id: randomUUID(), updatedAt: now, ...r }));
  const { data, error } = await db.from(table).upsert(withIds, { onConflict }).select();
  fail(`${table} upsert`, error);
  return data;
}

console.log("\nSeeding cloud project...\n");

// ---------------------------------------------------------------- roles
const roles = await upsert(
  "security_role",
  [
    {
      name: "Administrator",
      description: "Full access to every module and every record.",
      permissions: ["*"],
      dataScope: "ALL",
      isSystem: true,
    },
    {
      name: "Sales Manager",
      description: "Sees the whole team's pipeline; approves quotes and commissions.",
      permissions: [
        "lead:*", "account:*", "opportunity:*", "quotation:*", "contract:*",
        "partner:*", "commission:*", "payout:approve", "case:read",
        "project:read", "invoice:read",
      ],
      dataScope: "TEAM",
      isSystem: false,
    },
    {
      name: "Sales Executive",
      description: "Own records only. Can attach partners but not approve commission.",
      permissions: [
        "lead:read", "lead:write", "account:read", "account:write",
        "opportunity:read", "opportunity:write", "quotation:read",
        "quotation:write", "partner:read", "commission:read",
      ],
      dataScope: "OWN",
      isSystem: false,
    },
    {
      name: "Finance",
      description: "Invoicing, payments and partner payouts.",
      permissions: [
        "invoice:*", "payment:*", "commission:read", "payout:approve",
        "account:read", "opportunity:read",
      ],
      dataScope: "ALL",
      isSystem: false,
    },
  ],
  "name",
);
console.log(`  ok security_role       ${roles.length}`);

const roleId = Object.fromEntries(roles.map((r) => [r.name, r.id]));

/**
 * Insert-if-absent for tables with no unique constraint to conflict on.
 *
 * Department.name and Team.name are NOT unique in the schema, so upsert's
 * ON CONFLICT has no index to target and PostgREST rejects it. Look the row up
 * by name first and only insert when missing.
 */
async function ensureRow(table, match, row) {
  const { data: found, error: findErr } = await db
    .from(table)
    .select("*")
    .match(match)
    .limit(1);
  fail(`${table} lookup`, findErr);
  if (found?.length) return found[0];

  const { data, error } = await db
    .from(table)
    .insert({ id: randomUUID(), updatedAt: new Date().toISOString(), ...row })
    .select()
    .single();
  fail(`${table} insert`, error);
  return data;
}

// ----------------------------------------------------------- department
const dept = await ensureRow("department", { name: "Sales" }, { name: "Sales" });
console.log("  ok department          1");

// ---------------------------------------------------------------- users
const hash = await bcrypt.hash(PASSWORD, 10);

const users = await upsert(
  "app_user",
  [
    { email: "admin@babultech.com", fullName: "Hassan Shamsi", roleId: roleId["Administrator"], departmentId: dept.id, status: "ACTIVE", passwordHash: hash },
    { email: "sales.manager@babultech.com", fullName: "Ayesha Khan", roleId: roleId["Sales Manager"], departmentId: dept.id, status: "ACTIVE", passwordHash: hash },
    { email: "sales.exec@babultech.com", fullName: "Bilal Ahmed", roleId: roleId["Sales Executive"], departmentId: dept.id, status: "ACTIVE", passwordHash: hash },
    { email: "finance@babultech.com", fullName: "Sana Iqbal", roleId: roleId["Finance"], status: "ACTIVE", passwordHash: hash },
  ],
  "email",
);
console.log(`  ok app_user            ${users.length}`);

const userId = Object.fromEntries(users.map((u) => [u.email, u.id]));

// ----------------------------------------------------------------- team
// Team has teamType (required) and an optional manager — no departmentId.
const team = await ensureRow(
  "team",
  { name: "Core Sales" },
  {
    name: "Core Sales",
    teamType: "SALES",
    managerUserId: userId["sales.manager@babultech.com"],
    active: true,
  },
);

await upsert(
  "team_member",
  [
    { teamId: team.id, userId: userId["sales.manager@babultech.com"], roleInTeam: "Lead" },
    { teamId: team.id, userId: userId["sales.exec@babultech.com"], roleInTeam: "Member" },
  ],
  "teamId,userId",
);
console.log("  ok team + members      2");

// ------------------------------------------------------ number sequences
const sequences = [
  ["Lead", "LEAD"], ["Account", "ACC"], ["Opportunity", "OPP"],
  ["Quotation", "QUO"], ["Contract", "CTR"], ["Case", "CASE"],
  ["Project", "PRJ"], ["Invoice", "INV"], ["Payment", "PAY"],
  ["Expense", "EXP"], ["VendorBill", "VB"], ["VendorPayment", "VP"],
  ["Campaign", "CAM"], ["KnowledgeArticle", "KB"], ["ChangeRequest", "CR"],
  ["FinancialTransaction", "FT"], ["Partner", "PTR"],
  ["CommissionRecord", "COM"], ["CommissionPayout", "PO"],
];

await upsert(
  "number_sequence",
  sequences.map(([entityType, prefix]) => ({
    entityType, prefix, nextValue: 1, paddingLength: 5, includeYear: true,
  })),
  "entityType",
);
console.log(`  ok number_sequence     ${sequences.length}`);

// ------------------------------------------------------------- currency
// Currency is keyed on `code` (@id) and has no `id` column, so it bypasses the
// upsert() helper's id/updatedAt injection.
{
  const { error } = await db.from("currency").upsert(
    [
      { code: "PKR", name: "Pakistani Rupee", symbol: "Rs", isBase: true, exchangeRate: 1 },
      { code: "USD", name: "US Dollar", symbol: "$", isBase: false, exchangeRate: 278 },
    ],
    { onConflict: "code" },
  );
  fail("currency upsert", error);
}
console.log("  ok currency            2");

console.log(`
Done. Sign in at http://localhost:3000/login

  admin@babultech.com          Administrator
  sales.manager@babultech.com  Sales Manager
  sales.exec@babultech.com     Sales Exec
  finance@babultech.com        Finance

  Password: ${PASSWORD}
`);
