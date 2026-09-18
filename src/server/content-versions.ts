"use server";
import { revalidatePath } from "next/cache";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { versionSchema, reviewSchema, publicationSchema, type ContentVersionRow } from "@/lib/content-versions";
import type { ActionResult } from "./partners";

export type ReviewLinkRow = {
  id: string; versionId: string; recipientName: string; recipientEmail: string;
  createdAt: string; expiresAt: string; usedAt: string | null; revokedAt: string | null;
};

export async function getContentVersions(projectId: string, taskId: string, page = 1) {
 const user = await requirePermission(PERMISSIONS.PROJECT_READ); const db = await supabaseServer();
 const { data: task, error } = await db.from("project_task").select("id,name,projectId,status,assignedUserId").eq("id", taskId).eq("projectId", projectId).maybeSingle();
 if (error) throw new Error("Could not load content task."); if (!task) return null;
 const safePage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1;
 const [plan, versions, latest, manage, links] = await Promise.all([
 db.from("project_content_plan").select("revision,clientApprovalRequired,brief").eq("taskId", taskId).maybeSingle(),
 db.from("content_version").select("*,author:app_user!content_version_createdById_fkey(fullName),reviews:content_review(*,reviewer:app_user(fullName)),publications:content_publication(*)", { count: "exact" }).eq("taskId", taskId).order("versionNumber", { ascending: false }).range((safePage - 1) * 20, safePage * 20 - 1),
 db.from("content_version").select("versionNumber").eq("taskId", taskId).order("versionNumber", { ascending: false }).limit(1).maybeSingle(),
 db.rpc("app_project_access", { p_id: projectId, p_manage: true }),
 // Review links carry only a hash, never a usable token, so listing them here
 // exposes nothing an attacker could replay.
 db.from("client_review_link").select("id,versionId,recipientName,recipientEmail,createdAt,expiresAt,usedAt,revokedAt").order("createdAt", { ascending: false }),
 ]);
 if (plan.error || versions.error || latest.error || manage.error) throw new Error("Could not load content versions.");
 // PostgREST embeds the UNIQUE versionId publication relation as an object,
 // while reviews are to-many. Normalize both for the history renderer.
 const rows = (versions.data ?? []).map(row => ({ ...row,
 author: Array.isArray(row.author) ? row.author[0] ?? null : row.author,
 reviews: (Array.isArray(row.reviews) ? row.reviews : row.reviews ? [row.reviews] : []).map((review: ContentVersionRow["reviews"][number]) => ({ ...review, reviewer: Array.isArray(review.reviewer) ? review.reviewer[0] ?? null : review.reviewer })),
 publications: Array.isArray(row.publications) ? row.publications : row.publications ? [row.publications] : [],
 }));
 const linksByVersion = new Map<string, ReviewLinkRow[]>();
 for (const link of (links.data ?? []) as ReviewLinkRow[]) {
 const list = linksByVersion.get(link.versionId);
 if (list) list.push(link); else linksByVersion.set(link.versionId, [link]);
 }
 return { task, userId: user.id, plan: plan.data, canManage: manage.data === true, links: linksByVersion, canWrite: manage.data === true || task.assignedUserId === user.id, latest: latest.data?.versionNumber ?? 0, page: safePage, count: versions.count ?? 0, versions: rows as unknown as ContentVersionRow[] };
}
export async function mutateContentVersion(kind: "version" | "review" | "publication", input: unknown): Promise<ActionResult<{ id: string }>> {
 await requirePermission(PERMISSIONS.PROJECT_READ);
 let rpc: string; let args: Record<string, unknown>; let taskId: string | undefined; let versionId: string | undefined;
 if (kind === "version") {
 const parsed = versionSchema.safeParse(input); if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }; const v = parsed.data;
 rpc = "add_content_version"; taskId = v.taskId; args = { p_id: v.id, p_task: v.taskId, p_expected: v.expected, p_plan_revision: v.planRevision, p_copy: v.copy, p_asset_url: v.assetUrl, p_asset_sha: v.assetSha };
 } else if (kind === "review") {
 const parsed = reviewSchema.safeParse(input); if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }; const v = parsed.data;
 rpc = "review_content_version"; versionId = v.versionId; args = { p_id: v.id, p_version: v.versionId, p_stage: v.stage, p_decision: v.decision, p_evidence: v.evidence, p_client: v.client };
 } else if (kind === "publication") {
 const parsed = publicationSchema.safeParse(input); if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message }; const v = parsed.data;
 rpc = "record_content_publication"; versionId = v.versionId; args = { p_id: v.id, p_version: v.versionId, p_url: v.url, p_published: v.publishedAt };
 } else return { ok: false, error: "Unknown content action." };
 const db = await supabaseServer();
 if (versionId) { const { data, error } = await db.from("content_version").select("taskId").eq("id", versionId).maybeSingle(); if (error || !data) return { ok: false, error: "Version not available." }; taskId = data.taskId; }
 const { data: task, error: taskError } = await db.from("project_task").select("projectId").eq("id", taskId).maybeSingle();
 if (taskError || !task) return { ok: false, error: "Task not available." };
 const { data, error } = await db.rpc(rpc, args);
 if (error) return { ok: false, error: error.code === "40001" ? "Content or plan changed. Refresh and use a new version." : "Could not save. Check your assignment/reviewer access, latest version, required approvals and whether this action was already recorded." };
 revalidatePath(`/projects/${task.projectId}/content/${taskId}`); revalidatePath(`/projects/${task.projectId}/content`);
 return { ok: true, data: { id: String(data) } };
}
