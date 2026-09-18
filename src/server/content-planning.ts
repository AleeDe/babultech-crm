"use server";
import { revalidatePath } from "next/cache";
import { requirePermission, authorize, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { contentPlanSchema, contentMonth, type ContentPlan } from "@/lib/content-planning";
import type { ActionResult } from "./partners";
export async function getContentCalendar(projectId: string, month?: string, page = 1) {
 await requirePermission(PERMISSIONS.PROJECT_READ);
 const db = await supabaseServer(); const period = contentMonth(month);
 const safePage = Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10000) : 1;
 const { data: project, error: projectError } = await db.from("project").select("id,name").eq("id", projectId).maybeSingle();
 if (projectError) throw new Error("Could not load project.");
 if (!project) return null;
 const [plans, tasks, access] = await Promise.all([
 db.from("project_content_plan").select('*,task:project_task!inner(id,name,status,projectId,dueDate,assignedUserId,owner:app_user!project_task_assignedUserId_fkey(fullName))', { count: "exact" }).eq("task.projectId", projectId).gte("plannedPublishAt", period.start).lt("plannedPublishAt", period.end).order("plannedPublishAt").order("taskId").range((safePage - 1) * 40, safePage * 40 - 1),
 db.from("project_task").select("id,name", { count: "exact" }).eq("projectId", projectId).not("status", "in", "(COMPLETED,CANCELLED)").order("name").order("id").limit(500),
 db.rpc("app_project_access", { p_id: projectId, p_manage: true }),
 ]);
 if (plans.error || tasks.error || access.error) throw new Error("Could not load the content calendar.");
 return { project, period, page: safePage, count: plans.count ?? 0, canManage: access.data === true, tasks: tasks.data ?? [], taskCount: tasks.count ?? 0,
 rows: (plans.data ?? []).map(row => ({ ...row, task: Array.isArray(row.task) ? row.task[0] : row.task })) as (ContentPlan & { task: { id: string; name: string; status: string; projectId: string; dueDate: string | null; owner: { fullName: string } | null } })[] };
}
export async function saveContentPlan(input: unknown): Promise<ActionResult<{ id: string }>> {
 const auth = await authorize(PERMISSIONS.PROJECT_MANAGE); if (!auth.ok) return { ok: false, error: auth.error };
 const parsed = contentPlanSchema.safeParse(input); if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
 const db = await supabaseServer(); const v = parsed.data;
 const { data: task, error: taskError } = await db.from("project_task").select("projectId").eq("id", v.taskId).maybeSingle();
 if (taskError || !task) return { ok: false, error: "Task is not available." };
 const { error } = await db.rpc("save_content_plan", { p_task: v.taskId, p_expected_revision: v.expectedRevision, p_plan: v.plan });
 if (error) return { ok: false, error: error.code === "40001" ? "This task already has a plan or it changed. Open its planned month and refresh before editing." : "Could not save. Check project management access, the open task and all brief fields." };
 revalidatePath(`/projects/${task.projectId}/content`); return { ok: true, data: { id: v.taskId } };
}
