"use server";
import { requirePermission, PERMISSIONS, scopeFilter } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { applyScope } from "@/lib/db";
import { analyzeLeadQuality, type ResearchLead } from "@/lib/lead-quality";

export async function getLeadQuality() {
  const user = await requirePermission(PERMISSIONS.LEAD_READ);
  const where = await scopeFilter(user, "ownerUserId");
  const db = await supabaseServer();
  const leads: ResearchLead[] = [];
  let total = 0;
  // Bound the interactive scan explicitly; never silently claim a complete audit.
  for (let offset = 0; offset < 5000; offset += 500) {
    const query = db.from("lead").select("id,leadNumber,firstName,lastName,companyName,email,phone,whatsapp,leadSource,campaignId,referredByPartnerId,description,nextFollowUpAt", { count: "exact" })
      .is("deletedAt", null).is("convertedAt", null).not("status", "in", "(CONVERTED,DISQUALIFIED)").order("id");
    const { data, error, count } = await applyScope(query, where).range(offset, offset + 499);
    if (error) throw new Error("Could not load the research quality queue.");
    total = count ?? 0;
    leads.push(...(data ?? []) as ResearchLead[]);
    if (offset + 500 >= total) break;
  }
  return { rows: analyzeLeadQuality(leads), scanned: leads.length, total, truncated: total > leads.length };
}
