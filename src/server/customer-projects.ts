"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser, AuthorizationError } from "@/lib/authz";
import { listDeliverables, type Deliverable } from "./deliverables";

/**
 * The support portal's view of a customer's projects: progress, phases,
 * milestones and the deliverables handed to them. Row security returns only
 * their own company's projects (20260930000000), and never our plans, rates
 * or team.
 */

async function requireCustomer() {
  const me = await requireUser();
  if (me.userType !== "CUSTOMER") throw new AuthorizationError("This is for customer portal logins.");
  return me;
}

export interface CustomerProject {
  id: string;
  projectNumber: string;
  name: string;
  status: string;
  completionPercent: number;
  startDate: string | null;
  plannedEndDate: string | null;
}

export async function listCustomerProjects(): Promise<CustomerProject[]> {
  await requireCustomer();
  const db = await supabaseServer();
  const { data } = await db
    .from("project")
    .select("id, projectNumber, name, status, completionPercent, startDate, plannedEndDate")
    .is("deletedAt", null)
    .order("startDate", { ascending: false, nullsFirst: false });
  return (data ?? []).map((p) => ({ ...(p as unknown as CustomerProject), completionPercent: Number(p.completionPercent ?? 0) }));
}

export interface CustomerProjectDetail extends CustomerProject {
  phases: { id: string; name: string; status: string; completionPercent: number; plannedEnd: string | null }[];
  milestones: { id: string; name: string; status: string; dueDate: string | null; completedDate: string | null }[];
  deliverables: Deliverable[];
}

export async function getCustomerProject(id: string): Promise<CustomerProjectDetail | null> {
  await requireCustomer();
  const db = await supabaseServer();
  const { data: project } = await db
    .from("project")
    .select("id, projectNumber, name, status, completionPercent, startDate, plannedEndDate")
    .eq("id", id)
    .maybeSingle();
  if (!project) return null;
  const [{ data: phases }, { data: milestones }, deliverables] = await Promise.all([
    db.from("project_phase").select("id, name, status, completionPercent, plannedEnd, sequenceNumber").eq("projectId", id).order("sequenceNumber"),
    db.from("milestone").select("id, name, status, dueDate, completedDate").eq("projectId", id).order("dueDate", { nullsFirst: false }),
    listDeliverables(id),
  ]);
  return {
    ...(project as unknown as CustomerProject),
    completionPercent: Number(project.completionPercent ?? 0),
    phases: (phases ?? []).map((p) => ({
      id: p.id as string, name: p.name as string, status: p.status as string,
      completionPercent: Number(p.completionPercent ?? 0), plannedEnd: (p.plannedEnd as string | null) ?? null,
    })),
    milestones: (milestones ?? []) as CustomerProjectDetail["milestones"],
    deliverables,
  };
}
