"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/authz";

/**
 * Sign-in history. Row security decides whose: your own, or everyone's for an
 * administrator.
 */

export interface LoginEventRow {
  id: string;
  eventType: string;
  email: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: string | null;
  reason: string | null;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  targetUserId: string | null;
  targetName: string | null;
}

export async function listLoginEvents(opts: { userId?: string; eventType?: string; limit?: number } = {}): Promise<LoginEventRow[]> {
  await requireUser();
  const db = await supabaseServer();
  let query = db
    .from("login_event")
    .select(`id, eventType, email, ip, userAgent, detail, reason, createdAt, userId, targetUserId,
      user:app_user!login_event_userId_fkey ( fullName ),
      target:app_user!login_event_targetUserId_fkey ( fullName )`)
    .order("createdAt", { ascending: false })
    .limit(Math.min(opts.limit ?? 50, 500));
  // A View as by or of someone belongs in their history either way.
  if (opts.userId) query = query.or(`userId.eq.${opts.userId},targetUserId.eq.${opts.userId}`);
  if (opts.eventType) query = query.eq("eventType", opts.eventType);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load sign-in history: ${error.message}`);
  const name = (v: unknown) => ((Array.isArray(v) ? v[0] : v) as { fullName?: string } | null)?.fullName ?? null;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    eventType: r.eventType as string,
    email: (r.email as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
    userAgent: (r.userAgent as string | null) ?? null,
    detail: (r.detail as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    createdAt: r.createdAt as string,
    userId: (r.userId as string | null) ?? null,
    userName: name(r.user),
    targetUserId: (r.targetUserId as string | null) ?? null,
    targetName: name(r.target),
  }));
}
