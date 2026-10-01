"use server";

import { supabaseServer } from "@/lib/supabase";
import { authorize, requireUser } from "@/lib/authz";
import { getViewAs } from "@/lib/view-as";
import { RECORD_PATHS, RECORD_TYPE_LABEL } from "@/lib/record-paths";
import type { ActionResult } from "./partners";

/**
 * Favourite records: each person's own short list, shown in the search box and
 * on My work. Our team only - portal logins have no favourites.
 */

export interface FavoriteRecord {
  href: string;
  label: string;
  type: string;
  entityType: string;
  entityId: string;
}

export async function isFavorite(entityType: string, entityId: string): Promise<boolean | null> {
  try {
    const me = await requireUser();
    if (me.userType !== "INTERNAL" || !RECORD_PATHS[entityType]) return null;
    const db = await supabaseServer();
    const { data } = await db.from("favorite_record").select("entityId").eq("entityType", entityType).eq("entityId", entityId).maybeSingle();
    return Boolean(data);
  } catch {
    return null;
  }
}

export async function setFavorite(entityType: string, entityId: string, label: string, on: boolean): Promise<ActionResult<{ favorite: boolean }>> {
  const auth = await authorize();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (auth.user.userType !== "INTERNAL") return { ok: false, error: "Favourites are for our team." };
  if (!RECORD_PATHS[entityType]) return { ok: false, error: "That kind of record cannot be a favourite." };
  if (await getViewAs()) return { ok: false, error: "View as is read-only." };
  const db = await supabaseServer();
  const result = on
    ? await db.from("favorite_record").upsert({ entityType, entityId, label: label.trim().slice(0, 300) || "Untitled" }, { onConflict: "userId,entityType,entityId" })
    : await db.from("favorite_record").delete().eq("entityType", entityType).eq("entityId", entityId);
  if (result.error) return { ok: false, error: result.error.message };
  return { ok: true, data: { favorite: on } };
}

export async function listFavorites(limit = 30): Promise<FavoriteRecord[]> {
  try {
    const me = await requireUser();
    if (me.userType !== "INTERNAL") return [];
  } catch {
    return [];
  }
  const db = await supabaseServer();
  const { data } = await db
    .from("favorite_record")
    .select("entityType, entityId, label")
    .order("createdAt", { ascending: false })
    .limit(Math.min(limit, 100));
  return (data ?? [])
    .filter((r) => RECORD_PATHS[r.entityType as string])
    .map((r) => ({
      href: `${RECORD_PATHS[r.entityType as string]}${r.entityId}`,
      label: r.label as string,
      type: RECORD_TYPE_LABEL[r.entityType as string] ?? (r.entityType as string),
      entityType: r.entityType as string,
      entityId: r.entityId as string,
    }));
}
