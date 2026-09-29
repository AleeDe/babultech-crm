import { after } from "next/server";
import { supabaseAdmin } from "./supabase";
import { JOB_HANDLERS, RUNNER_CHORES, type JobRow } from "./job-handlers";

/**
 * Background jobs: queueing them, and running them.
 *
 * A job is a row in `job` (supabase/migrations/20260929000000_background_jobs.sql).
 * Queueing one returns at once and starts the runner after the response has
 * gone, so the person who asked is not kept waiting and a short job is still
 * done within seconds. Anything left over - a job cut off by the time limit, or
 * one whose runner died - is picked up by the scheduler's next visit to
 * /api/jobs/run, which calls the same runJobs() below.
 *
 * Handlers work in chunks. Each call does a bounded amount of work, records
 * where it got to in `cursor`, and says whether it is finished; the runner
 * keeps calling until it is, or until its time is up and the job goes back in
 * the queue to be carried on next time. That is what makes a job resumable
 * rather than something that has to finish inside one request.
 */

export interface QueueJobInput {
  jobType: keyof typeof JOB_HANDLERS;
  title: string;
  payload: Record<string, unknown>;
  progressTotal?: number | null;
  createdById: string | null;
}

export async function queueJob(input: QueueJobInput): Promise<{ id: string }> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("job")
    .insert({
      jobType: input.jobType,
      title: input.title.slice(0, 300),
      payload: input.payload,
      progressTotal: input.progressTotal ?? null,
      createdById: input.createdById,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not queue the job: ${error?.message ?? "no row"}`);
  startRunnerSoon();
  return { id: data.id as string };
}

/**
 * Runs the queue once the current response has been sent.
 *
 * `after()` needs a request to hang off. Outside one - a script, a test - it
 * throws, and the scheduler picks the work up instead.
 */
export function startRunnerSoon(): void {
  try {
    after(() => runJobs("REQUEST").catch(() => {}));
  } catch {
    /* Not inside a request; the scheduler will run it. */
  }
}

export interface RunSummary {
  processed: number;
  jobs: number;
}

/**
 * Works through the queue until it is empty or `budgetMs` is spent.
 *
 * The budget is kept well inside the hosting platform's time limit, so a run
 * always gets to record where it stopped rather than being killed mid-write.
 */
export async function runJobs(trigger: "SCHEDULER" | "REQUEST" | "MANUAL", budgetMs = 40_000): Promise<RunSummary> {
  const db = supabaseAdmin();
  const deadline = Date.now() + budgetMs;
  const { data: run } = await db.from("job_runner_run").insert({ trigger }).select("id").single();

  let processed = 0;
  let jobs = 0;
  let failure: string | null = null;

  try {
    while (Date.now() < deadline - 3_000) {
      const { data: claimed, error } = await db.rpc("claim_jobs", { p_limit: 2, p_lease_seconds: 120 });
      if (error) throw new Error(error.message);
      const list = (claimed ?? []) as JobRow[];
      if (list.length === 0) break;

      for (const job of list) {
        jobs += 1;
        processed += await runOne(job, deadline);
      }
    }

    for (const chore of RUNNER_CHORES) {
      if (Date.now() >= deadline - 3_000) break;
      processed += await chore(deadline);
    }
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  } finally {
    if (run) {
      await db
        .from("job_runner_run")
        .update({ finishedAt: new Date().toISOString(), processed, error: failure })
        .eq("id", run.id);
    }
  }

  return { processed, jobs };
}

/** Runs one job for as long as the budget allows. Returns items processed. */
async function runOne(job: JobRow, deadline: number): Promise<number> {
  const db = supabaseAdmin();
  const handler = JOB_HANDLERS[job.jobType as keyof typeof JOB_HANDLERS];
  let processed = 0;
  let current = job;

  if (!handler) {
    await finish(job.id, "FAILED", { errors: [...(job.errors ?? []), `No handler for ${job.jobType}.`] });
    return 0;
  }

  // A job that keeps dying is stopped rather than retried for ever.
  if (job.attempts > 25) {
    await finish(job.id, "FAILED", { errors: [...(job.errors ?? []), "Stopped after too many attempts."] });
    return 0;
  }

  try {
    while (Date.now() < deadline - 3_000) {
      const step = await handler(current);
      processed += step.processed;
      const errors = [...(current.errors ?? []), ...(step.errors ?? [])].slice(-200);
      const progressDone = current.progressDone + step.processed;

      if (step.done) {
        await finish(job.id, "DONE", {
          progressDone,
          progressTotal: step.progressTotal ?? current.progressTotal ?? progressDone,
          cursor: step.cursor ?? current.cursor,
          result: step.result ?? null,
          errors,
        });
        return processed;
      }

      current = { ...current, progressDone, cursor: step.cursor ?? current.cursor, errors, progressTotal: step.progressTotal ?? current.progressTotal };
      // Only while it is still running: a job someone stopped stays stopped.
      const { data: still } = await db
        .from("job")
        .update({
          progressDone,
          progressTotal: current.progressTotal,
          cursor: current.cursor,
          errors,
          lockedUntil: new Date(Date.now() + 120_000).toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .eq("id", job.id)
        .eq("status", "RUNNING")
        .select("id");
      if (!still?.length) return processed;
    }

    // Out of time: back in the queue, carrying on from the cursor next visit.
    await db
      .from("job")
      .update({ status: "QUEUED", lockedUntil: null, updatedAt: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "RUNNING");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finish(job.id, "FAILED", { errors: [...(current.errors ?? []), message].slice(-200), progressDone: current.progressDone });
  }
  return processed;
}

async function finish(id: string, status: "DONE" | "FAILED", fields: Record<string, unknown>) {
  const at = new Date().toISOString();
  const db = supabaseAdmin();
  const { data: job } = await db
    .from("job")
    .update({ ...fields, status, finishedAt: at, lockedUntil: null, updatedAt: at })
    .eq("id", id)
    .in("status", ["QUEUED", "RUNNING"])
    .select("id, title, jobType, payload, createdById, progressDone")
    .maybeSingle();

  // Whoever started it hears that it finished, under the bell.
  if (job?.createdById) {
    const link = job.jobType === "lead_email" && (job.payload as { batchId?: string })?.batchId
      ? `/leads/email/sends/${(job.payload as { batchId: string }).batchId}`
      : "/jobs";
    await db.rpc("notify_user", {
      p_user: job.createdById,
      p_kind: "JOB_FINISHED",
      p_title: status === "DONE" ? `Finished: ${job.title}` : `Failed: ${job.title}`,
      p_body: status === "DONE" ? `${job.progressDone} done.` : "Open it to see what went wrong.",
      p_link: link,
      p_entity_type: "Job",
      p_entity_id: job.id,
      p_dedupe: `job:${job.id}`,
      p_allow_email: true,
    });
  }
}
