"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/authz";
import { getViewAs } from "@/lib/view-as";

/**
 * Recently opened records, for the search box and My work.
 */

const PATHS: Record<string, string> = {
  Lead: "/leads/",
  Account: "/accounts/",
  Contact: "/contacts/",
  Opportunity: "/opportunities/",
  SupportCase: "/cases/",
  Project: "/projects/",
  Quotation: "/quotations/",
  Campaign: "/campaigns/",
  Partner: "/partners/",
  Invoice: "/invoices/",
};

const TYPE_LABEL: Record<string, string> = {
  Lead: "Lead",
  Account: "Account",
  Contact: "Contact",
  Opportunity: "Deal",
  SupportCase: "Case",
  Project: "Project",
  Quotation: "Quote",
  Campaign: "Campaign",
  Partner: "Partner",
  Invoice: "Invoice",
};

export interface RecentRecord {
  href: string;
  label: string;
  type: string;
  viewedAt: string;
}

/** Notes that the signed-in person opened a record. Never fails the page. */
export async function noteRecent(entityType: string, entityId: string, label: string): Promise<void> {
  if (!PATHS[entityType] || !label.trim()) return;
  try {
    if (await getViewAs()) return; // A view changes nothing, this included.
    const user = await requireUser();
    if (user.userType !== "INTERNAL") return;
    const db = await supabaseServer();
    await db.rpc("note_recent_record", { p_entity_type: entityType, p_entity_id: entityId, p_label: label.trim() });
  } catch {
    /* A list of recent records is not worth a failed page. */
  }
}

export async function listRecent(limit = 12): Promise<RecentRecord[]> {
  try {
    const user = await requireUser();
    if (user.userType !== "INTERNAL") return [];
  } catch {
    return [];
  }
  const db = await supabaseServer();
  const { data } = await db
    .from("recent_record")
    .select("entityType, entityId, label, viewedAt")
    .order("viewedAt", { ascending: false })
    .limit(Math.min(limit, 30));
  return (data ?? [])
    .filter((r) => PATHS[r.entityType as string])
    .map((r) => ({
      href: `${PATHS[r.entityType as string]}${r.entityId}`,
      label: r.label as string,
      type: TYPE_LABEL[r.entityType as string] ?? (r.entityType as string),
      viewedAt: r.viewedAt as string,
    }));
}
