/**
 * Which piloted workflows can actually be run today.
 *
 * Read-only. Reads grants and record counts, never emails, credentials, rates
 * or any record content. Run it again after changing roles or once real work
 * arrives, rather than trusting what the runbook said on the day it was written.
 *
 *   npx tsx scripts/pilot-readiness.ts
 *   npx tsx scripts/pilot-readiness.ts --json
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { assessPilot, summarise, type PilotUser, type PilotCounts } from "../src/lib/pilot-readiness";

config({ path: ".env", quiet: true });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and service credential must be configured.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Paginate so a growing staff list cannot silently truncate the assessment.
  async function readAll(table: string, columns: string) {
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from(table).select(columns).order("id").range(offset, offset + 499);
      if (error) throw new Error(`Could not read ${table}; check database connectivity and schema.`);
      rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
      if (!data || data.length < 500) return rows;
    }
  }

  /** Count rows, optionally excluding soft-deleted ones or filtering a column. */
  async function count(table: string, options: { live?: boolean; eq?: [string, string]; key?: string } = {}) {
    let query = db.from(table).select(options.key ?? "id", { count: "exact", head: true });
    if (options.eq) query = query.eq(options.eq[0], options.eq[1]);
    if (options.live) query = query.is("deletedAt", null);
    const { count: total, error } = await query;
    if (error) throw new Error(`Could not count ${table}.`);
    return total ?? 0;
  }

  const [rawUsers, roles] = await Promise.all([
    readAll("app_user", "id,fullName,status,deletedAt,partnerId,roleId"),
    readAll("security_role", "id,name,dataScope,permissions,active"),
  ]);

  const rolesById = new Map(roles.map((r) => [r.id as string, r]));
  const users: PilotUser[] = rawUsers.map((u) => {
    const role = rolesById.get(u.roleId as string);
    return {
      fullName: (u.fullName as string) ?? "Unnamed user",
      status: u.status as string,
      deletedAt: (u.deletedAt as string | null) ?? null,
      partnerId: (u.partnerId as string | null) ?? null,
      role: role
        ? {
            name: role.name as string,
            dataScope: role.dataScope as string,
            permissions: (role.permissions as string[]) ?? [],
            active: role.active !== false,
          }
        : null,
    };
  });

  const counts: PilotCounts = {
    leads: await count("lead", { live: true }),
    customers: await count("account", { live: true, eq: ["accountType", "CUSTOMER"] }),
    contracts: await count("contract", { live: true }),
    invoices: await count("invoice", { live: true }),
    projects: await count("project", { live: true }),
    // project_task has no soft-delete column.
    tasks: await count("project_task"),
    // project_content_plan is keyed by the task it extends.
    contentPlans: await count("project_content_plan", { key: "taskId" }),
  };

  const workflows = assessPilot(users, counts);
  const totals = summarise(workflows);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ reviewedAt: new Date().toISOString(), mode: "read-only", totals, counts, workflows }, null, 2));
    return;
  }

  console.log(`Pilot readiness, ${new Date().toISOString().slice(0, 10)} (read-only)\n`);
  console.log(`${totals.ready} of ${totals.total} workflows can be run today.\n`);

  for (const workflow of workflows) {
    console.log(`${workflow.ready ? "READY  " : "BLOCKED"}  ${workflow.workflow}`);
    if (workflow.people.length) console.log(`          who: ${workflow.people.join(", ")}`);
    for (const blocker of workflow.blockers) console.log(`          - ${blocker}`);
    console.log();
  }

  console.log("Records:", Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));
  console.log("\nThis reads grants and record counts only. It cannot tell you whether a");
  console.log("workflow fits how the team actually works - that is what the pilot is for.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Pilot readiness check failed.");
  process.exitCode = 1;
});
