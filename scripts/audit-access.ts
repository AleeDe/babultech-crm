/** Read-only baseline. Never selects emails, credentials, salary, or rate columns. */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { analyzeAccessBaseline, type AccessBaseline } from "../src/lib/access-baseline";

config({ path: ".env", quiet: true });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and service credential must be configured.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // Paginate so a growing staff/project list cannot silently truncate the audit.
  async function read(table: string, columns: string) {
    const rows: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from(table).select(columns).order("id").range(offset, offset + 499);
      if (error) throw new Error(`Could not audit ${table}; verify database connectivity and schema.`);
      rows.push(...(data ?? []) as unknown as Record<string, unknown>[]);
      if (!data || data.length < 500) return rows;
    }
  }

  const [users, roles, teamMembers, projectMembers, projects] = await Promise.all([
    read("app_user", "id,status,deletedAt,jobTitle,managerUserId,roleId"),
    read("security_role", "id,name,dataScope,permissions"),
    read("team_member", "id,userId,teamId"),
    read("project_member", "id,userId,projectId,active"),
    read("project", "id,projectManagerId,deletedAt"),
  ]);
  const report = analyzeAccessBaseline({ users, roles, teamMembers, projectMembers, projects } as unknown as AccessBaseline);
  const details = process.argv.includes("--details");
  console.log(JSON.stringify({
    reviewedAt: new Date().toISOString(),
    mode: "read-only",
    activeUsers: report.counts.activeUsers,
    roleCount: report.counts.roles,
    projects: report.counts.projects,
    roles: roles.map((r) => ({ name: r.name, scope: r.dataScope, permissions: r.permissions })),
    findings: Object.fromEntries(Object.entries(report.findings).map(([key, value]) => [key, details ? value : value.length])),
    note: "Findings require review, not automatic reassignment. This does not test deployed RLS or prove access isolation.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Access audit failed.");
  process.exitCode = 1;
});
