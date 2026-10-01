"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/authz";
import { RECORD_PATHS } from "@/lib/record-paths";

/**
 * Records breaking a data quality rule, from the view data_quality_issue, read
 * under the person's own row security.
 */

export interface QualityIssue {
  href: string;
  label: string;
  since: string;
  ownerName: string | null;
}

export interface QualityRuleResult {
  rule: string;
  count: number;
  /** The oldest first, up to 25. */
  records: QualityIssue[];
}

export async function getDataQuality(options: { mine?: boolean } = {}): Promise<QualityRuleResult[]> {
  const me = await requireUser();
  const db = await supabaseServer();
  let query = db
    .from("data_quality_issue")
    .select("rule, entityType, entityId, label, since, ownerUserId")
    .order("since", { ascending: true })
    .limit(5000);
  if (options.mine) query = query.eq("ownerUserId", me.id);
  const { data, error } = await query;
  if (error) throw new Error(`Could not check data quality: ${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];

  // A view has no foreign keys to embed through, so owners are looked up once.
  const ownerIds = [...new Set(rows.map((r) => r.ownerUserId as string).filter(Boolean))];
  const names = new Map<string, string>();
  if (ownerIds.length) {
    const { data: users } = await db.from("app_user").select("id, fullName").in("id", ownerIds);
    for (const u of users ?? []) names.set(u.id as string, u.fullName as string);
  }

  const byRule = new Map<string, QualityRuleResult>();
  for (const r of rows) {
    const path = RECORD_PATHS[r.entityType as string];
    if (!path) continue;
    const rule = r.rule as string;
    const bucket = byRule.get(rule) ?? { rule, count: 0, records: [] };
    bucket.count += 1;
    if (bucket.records.length < 25) {
      bucket.records.push({
        href: `${path}${r.entityId}`,
        label: (r.label as string) || "Untitled",
        since: r.since as string,
        ownerName: names.get(r.ownerUserId as string) ?? null,
      });
    }
    byRule.set(rule, bucket);
  }
  return [...byRule.values()];
}
