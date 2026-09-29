"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { authorize, requireUser, can, PERMISSIONS } from "@/lib/authz";
import { runJobs } from "@/lib/jobs";
import type { ActionResult } from "./partners";

/**
 * The Jobs screen: background work you started, and - for administrators -
 * everyone's, with the scheduler's health and its one setting.
 */

export interface JobSummary {
  id: string;
  jobType: string;
  title: string;
  status: string;
  progressDone: number;
  progressTotal: number | null;
  errors: string[];
  createdAt: string;
  finishedAt: string | null;
  createdByName: string | null;
  link: string | null;
}

export async function listJobs(): Promise<JobSummary[]> {
  await requireUser();
  const db = await supabaseServer();
  const { data, error } = await db
    .from("job")
    .select(`id, jobType, title, status, progressDone, progressTotal, errors, payload, createdAt, finishedAt,
      createdBy:app_user!job_createdById_fkey ( fullName )`)
    .order("createdAt", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load jobs: ${error.message}`);
  return (data ?? []).map((row) => {
    const createdBy = (Array.isArray(row.createdBy) ? row.createdBy[0] : row.createdBy) as { fullName?: string } | null;
    const payload = (row.payload ?? {}) as { batchId?: string };
    return {
      id: row.id as string,
      jobType: row.jobType as string,
      title: row.title as string,
      status: row.status as string,
      progressDone: Number(row.progressDone ?? 0),
      progressTotal: row.progressTotal == null ? null : Number(row.progressTotal),
      errors: (row.errors as string[] | null) ?? [],
      createdAt: row.createdAt as string,
      finishedAt: (row.finishedAt as string | null) ?? null,
      createdByName: createdBy?.fullName ?? null,
      link: row.jobType === "lead_email" && payload.batchId ? `/leads/email/sends/${payload.batchId}` : null,
    };
  });
}

export interface RunnerStatus {
  publicAppUrl: string | null;
  suggestedUrl: string | null;
  lastRuns: { startedAt: string; finishedAt: string | null; processed: number; trigger: string; error: string | null }[];
}

/** For administrators: where the scheduler calls, and how its last visits went. */
export async function getRunnerStatus(): Promise<RunnerStatus | null> {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.ADMIN)) return null;
  const db = await supabaseServer();
  const [{ data: setting }, { data: runs }] = await Promise.all([
    db.from("company_setting").select("publicAppUrl").eq("id", true).maybeSingle(),
    db.from("job_runner_run").select("startedAt, finishedAt, processed, trigger, error").order("startedAt", { ascending: false }).limit(10),
  ]);

  // Offered as the address to use: whatever this page was reached at.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  const suggestedUrl = host ? `${proto}://${host}` : null;

  return {
    publicAppUrl: (setting?.publicAppUrl as string | null) ?? null,
    suggestedUrl,
    lastRuns: (runs ?? []) as RunnerStatus["lastRuns"],
  };
}

const urlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https:\/\/[^\s/]+(\/.*)?$/.test(v), "Use the site's full https:// address, such as https://crm.example.com.");

export async function saveSchedulerAddress(url: string): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = urlSchema.safeParse(url);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That address is not valid." };

  const db = await supabaseServer();
  const { error } = await db
    .from("company_setting")
    .update({ publicAppUrl: parsed.data.replace(/\/+$/, "") || null, updatedAt: new Date().toISOString(), updatedById: auth.user.id })
    .eq("id", true);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/jobs");
  return { ok: true, data: undefined };
}

/** Runs the queue now, for an administrator who does not want to wait a minute. */
export async function runJobsNow(): Promise<ActionResult<{ processed: number }>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const summary = await runJobs("MANUAL", 20_000);
  revalidatePath("/jobs");
  return { ok: true, data: { processed: summary.processed } };
}

/** Stops a job that has not finished. Its creator or an administrator may. */
export async function cancelJob(id: string): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "That job could not be found." };

  // Read as the person, so only a job they can see can be stopped.
  const db = await supabaseServer();
  const { data: job } = await db.from("job").select("id, status, createdById").eq("id", id).maybeSingle();
  if (!job) return { ok: false, error: "That job could not be found." };
  if (job.createdById !== auth.user.id && !can(auth.user, PERMISSIONS.ADMIN)) {
    return { ok: false, error: "Only whoever started it, or an administrator, can stop it." };
  }
  if (!["QUEUED", "RUNNING"].includes(job.status as string)) return { ok: false, error: "That job has already finished." };

  const at = new Date().toISOString();
  const { error } = await supabaseAdmin()
    .from("job")
    .update({ status: "CANCELLED", finishedAt: at, lockedUntil: null, updatedAt: at })
    .eq("id", id)
    .in("status", ["QUEUED", "RUNNING"]);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/jobs");
  return { ok: true, data: undefined };
}
