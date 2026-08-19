/**
 * Full-table backup taken immediately before the ClickUp migration wipe.
 *
 * The migration deletes every row in the CRM, app_user and auth.users included,
 * so this is the only way back if the identity rebuild goes wrong. It writes one
 * JSON file per table plus a manifest, under backups/<timestamp>/.
 *
 * Run: node scripts/backup-before-clickup.mjs
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

// Every table in the schema. Order does not matter for a read.
const TABLES = [
  "account", "activity", "app_user", "approval_request", "approval_step",
  "audit_history", "bank_account", "business_hours", "campaign",
  "campaign_member", "campaign_type", "case_category", "case_comment",
  "change_request", "commission_payout", "commission_plan", "commission_record",
  "commission_tier", "contact", "contract", "currency", "department",
  "document", "email", "expense", "expense_category", "financial_transaction",
  "invoice", "invoice_line", "knowledge_article", "lead", "milestone", "note",
  "number_sequence", "opportunity", "opportunity_partner", "opportunity_product",
  "partner", "partner_contact", "payment", "payment_allocation", "product",
  "project", "project_issue", "project_member", "project_phase", "project_risk",
  "project_task", "quotation", "quote_line", "security_role", "sla_policy",
  "sla_timer_event", "support_case", "tax_rate", "team", "team_member",
  "time_log", "training", "training_participant", "vendor_bill",
  "vendor_bill_line", "vendor_payment", "vendor_payment_allocation",
];

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = join("backups", stamp);
mkdirSync(dir, { recursive: true });

console.log(`\nBacking up to ${dir}\n`);

const manifest = {};
let total = 0;

for (const table of TABLES) {
  const { data, error } = await db.from(table).select("*");
  if (error) {
    console.error(`  x ${table}: ${error.message}`);
    manifest[table] = { error: error.message };
    continue;
  }
  writeFileSync(join(dir, `${table}.json`), JSON.stringify(data, null, 1));
  manifest[table] = { rows: data.length };
  total += data.length;
  if (data.length) console.log(`  - ${table}: ${data.length}`);
}

// auth.users lives outside PostgREST and needs the admin API. Without these the
// app_user rows restore but nobody can log in.
const { data: authList, error: authErr } = await db.auth.admin.listUsers({ perPage: 1000 });
if (authErr) {
  console.error(`  x auth.users: ${authErr.message}`);
} else {
  writeFileSync(join(dir, "_auth_users.json"), JSON.stringify(authList.users, null, 1));
  manifest["_auth_users"] = { rows: authList.users.length };
  console.log(`  - auth.users: ${authList.users.length}`);
}

writeFileSync(join(dir, "_manifest.json"), JSON.stringify(manifest, null, 1));

console.log(`\nDone. ${total} CRM rows saved under ${dir}\n`);
