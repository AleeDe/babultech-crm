import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runJobs } from "@/lib/jobs";

/**
 * The background runner's door.
 *
 * Supabase's scheduler calls this every minute there is work waiting
 * (jobs_tick() in supabase/migrations/20260929000000_background_jobs.sql). The
 * call carries a key kept in the Supabase vault, and nothing happens until the
 * database confirms it matches - so the key never has to be copied into the
 * hosting platform's settings, and there is only one place it lives.
 */

// Long enough for a run's 40-second budget with room to write where it stopped.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const key = request.headers.get("x-jobs-key") ?? "";
  const { data: matches, error } = await supabaseAdmin().rpc("jobs_key_matches", { p_key: key });
  if (error || matches !== true) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const summary = await runJobs("SCHEDULER");
  return NextResponse.json({ ok: true, ...summary });
}
