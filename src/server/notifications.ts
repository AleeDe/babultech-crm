"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { authorize, requireUser } from "@/lib/authz";
import { NOTIFICATION_KINDS, FOLLOWABLE_TYPES, type FollowableType } from "@/lib/notification-kinds";
import type { ActionResult } from "./partners";

/**
 * The bell, the notifications page, alert settings and following.
 *
 * Everything reads through the person's own session: row security returns
 * their notifications, their preferences and their follows, and nobody else's.
 * The rows themselves are written by the database (see the notifications
 * migration), never from here.
 */

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
  actorName: string | null;
}

const SELECT = `id, kind, title, body, link, createdAt, readAt,
  actor:app_user!notification_actorId_fkey ( fullName )`;

function toItem(row: Record<string, unknown>): NotificationItem {
  const actor = (Array.isArray(row.actor) ? row.actor[0] : row.actor) as { fullName?: string } | null;
  return {
    id: row.id as string,
    kind: row.kind as string,
    title: row.title as string,
    body: (row.body as string | null) ?? null,
    link: (row.link as string | null) ?? null,
    createdAt: row.createdAt as string,
    readAt: (row.readAt as string | null) ?? null,
    actorName: actor?.fullName ?? null,
  };
}

/** What the bell shows: the unread count and the latest few. */
export async function loadBell(): Promise<{ unread: number; items: NotificationItem[] }> {
  try {
    const user = await requireUser();
    if (user.userType !== "INTERNAL") return { unread: 0, items: [] };
  } catch {
    return { unread: 0, items: [] };
  }
  const db = await supabaseServer();
  const [{ count }, { data }] = await Promise.all([
    db.from("notification").select("id", { count: "exact", head: true }).eq("inApp", true).is("readAt", null),
    db.from("notification").select(SELECT).eq("inApp", true).order("createdAt", { ascending: false }).limit(8),
  ]);
  return { unread: count ?? 0, items: (data ?? []).map(toItem) };
}

export async function listNotifications(opts: { unreadOnly?: boolean; page?: number } = {}): Promise<{
  items: NotificationItem[];
  hasMore: boolean;
}> {
  await requireUser();
  const db = await supabaseServer();
  const pageSize = 50;
  const page = Math.max(1, opts.page ?? 1);
  let query = db
    .from("notification")
    .select(SELECT)
    .eq("inApp", true)
    .order("createdAt", { ascending: false })
    .range((page - 1) * pageSize, page * pageSize);
  if (opts.unreadOnly) query = query.is("readAt", null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load notifications: ${error.message}`);
  const rows = (data ?? []).map(toItem);
  return { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize };
}

/** Marks some notifications read, or all of them when no ids are given. */
export async function markNotificationsRead(ids?: string[]): Promise<ActionResult<{ marked: number }>> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = z.array(z.string().uuid()).max(500).optional().safeParse(ids);
  if (!parsed.success) return { ok: false, error: "Those notifications could not be found." };
  const db = await supabaseServer();
  const { data, error } = await db.rpc("mark_notifications_read", { p_ids: parsed.data ?? null });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/notifications");
  return { ok: true, data: { marked: Number(data ?? 0) } };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface PreferenceRow {
  kind: string;
  inApp: boolean;
  email: boolean;
}

export async function getNotificationPreferences(): Promise<PreferenceRow[]> {
  const user = await requireUser();
  const db = await supabaseServer();
  const { data } = await db.from("notification_preference").select("kind, inApp, email").eq("userId", user.id);
  const saved = new Map((data ?? []).map((r) => [r.kind as string, r]));
  return NOTIFICATION_KINDS.map((k) => {
    const row = saved.get(k.kind);
    return {
      kind: k.kind,
      inApp: row ? Boolean(row.inApp) : true,
      email: "emailFixed" in k && k.emailFixed ? false : row ? Boolean(row.email) : k.emailByDefault,
    };
  });
}

const preferencesSchema = z.array(
  z.object({
    kind: z.enum(NOTIFICATION_KINDS.map((k) => k.kind) as [string, ...string[]]),
    inApp: z.boolean(),
    email: z.boolean(),
  }),
);

export async function saveNotificationPreferences(rows: PreferenceRow[]): Promise<ActionResult> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.user.userType !== "INTERNAL") return { ok: false, error: "Only employees have notification settings." };
  const parsed = preferencesSchema.safeParse(rows);
  if (!parsed.success) return { ok: false, error: "Those settings could not be saved." };

  const db = await supabaseServer();
  const { error } = await db.from("notification_preference").upsert(
    parsed.data.map((r) => ({
      userId: auth.user.id,
      kind: r.kind,
      inApp: r.inApp,
      email: NOTIFICATION_KINDS.some((k) => k.kind === r.kind && "emailFixed" in k && k.emailFixed) ? false : r.email,
      updatedAt: new Date().toISOString(),
    })),
    { onConflict: "userId,kind" },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath("/notifications/settings");
  return { ok: true, data: undefined };
}

// ---------------------------------------------------------------------------
// Following
// ---------------------------------------------------------------------------

const followSchema = z.object({
  entityType: z.enum(FOLLOWABLE_TYPES),
  entityId: z.string().uuid(),
});

export async function getFollowState(entityType: FollowableType, entityId: string): Promise<{ following: boolean; followers: number }> {
  const user = await requireUser();
  const db = await supabaseServer();
  const { data } = await db
    .from("record_follow")
    .select("userId")
    .eq("entityType", entityType)
    .eq("entityId", entityId)
    .eq("userId", user.id)
    .maybeSingle();
  return { following: Boolean(data), followers: 0 };
}

export async function setFollowing(entityType: FollowableType, entityId: string, follow: boolean): Promise<ActionResult<{ following: boolean }>> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = followSchema.safeParse({ entityType, entityId });
  if (!parsed.success) return { ok: false, error: "That record cannot be followed." };

  const db = await supabaseServer();
  if (follow) {
    const { error } = await db.rpc("follow_record", { p_entity_type: entityType, p_entity_id: entityId });
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await db
      .from("record_follow")
      .delete()
      .eq("userId", auth.user.id)
      .eq("entityType", entityType)
      .eq("entityId", entityId);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true, data: { following: follow } };
}
