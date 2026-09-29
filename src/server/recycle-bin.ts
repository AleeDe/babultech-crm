"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { authorize, requireUser, can, PERMISSIONS } from "@/lib/authz";
import { RECYCLE_TYPES, recycleLabel, type RecycleType } from "@/lib/recycle-types";
import type { ActionResult } from "./partners";

/**
 * Deleting to the recycle bin, restoring, and erasing for good.
 *
 * The person must hold the kind's delete permission and be able to see the
 * record - checked through their own session, so row security decides. The
 * hide itself is written with the service role, because a delete permission
 * can reach records the person's edit rights do not (a manager tidying up a
 * rep's leads). Why a delete is refused is decided by recycle_blocker() in the
 * recycle bin migration, so the button and the rule cannot disagree.
 */

const idSchema = z.object({ type: z.enum(Object.keys(RECYCLE_TYPES) as [RecycleType, ...RecycleType[]]), id: z.string().uuid() });

async function audit(type: RecycleType, id: string, userId: string, oldValue: string | null, newValue: string | null) {
  await supabaseAdmin().from("audit_history").insert({
    id: crypto.randomUUID(),
    entityType: type,
    entityId: id,
    fieldName: "deletedAt",
    oldValue,
    newValue,
    changedById: userId,
    source: "UI",
    changedAt: new Date().toISOString(),
  });
}

function revalidate(type: RecycleType, id: string) {
  const path = RECYCLE_TYPES[type].path;
  revalidatePath(path.slice(0, -1));
  revalidatePath(`${path}${id}`);
  revalidatePath("/recycle-bin");
}

/** Whether the record is in the bin, and whether it could be deleted now. */
export async function getRecycleState(type: RecycleType, id: string): Promise<{ deleted: boolean; blocker: string | null; canDelete: boolean }> {
  const user = await requireUser();
  const config = RECYCLE_TYPES[type];
  const canDelete = can(user, config.permission);
  if (!canDelete) return { deleted: false, blocker: null, canDelete };
  const db = await supabaseServer();
  const { data } = await db.from(config.table).select("deletedAt, deletedById").eq("id", id).maybeSingle();
  const deleted = Boolean(data?.deletedAt && data?.deletedById);
  if (deleted) return { deleted, blocker: null, canDelete };
  const { data: blocker } = await supabaseAdmin().rpc("recycle_blocker", { p_entity_type: type, p_id: id });
  return { deleted, blocker: (blocker as string | null) ?? null, canDelete };
}

export async function deleteToRecycleBin(type: RecycleType, id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse({ type, id });
  if (!parsed.success) return { ok: false, error: "That record could not be found." };
  const config = RECYCLE_TYPES[type];
  const auth = await authorize(config.permission);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  const { data: seen } = await db.from(config.table).select("id, deletedAt").eq("id", id).maybeSingle();
  if (!seen) return { ok: false, error: "That record could not be found." };
  if (seen.deletedAt) return { ok: false, error: "It is already deleted." };

  const admin = supabaseAdmin();
  const { data: blocker } = await admin.rpc("recycle_blocker", { p_entity_type: type, p_id: id });
  if (blocker) return { ok: false, error: `It cannot be deleted: ${blocker}` };

  const stamp = new Date().toISOString();
  const hide = { deletedAt: stamp, deletedById: auth.user.id, updatedAt: stamp };
  const { error } = await admin.from(config.table).update(hide).eq("id", id).is("deletedAt", null);
  if (error) return { ok: false, error: error.message };

  // What belongs only to it goes with it, stamped the same so a restore
  // brings exactly that back.
  if (type === "Account") {
    await admin.from("contact").update(hide).eq("accountId", id).is("deletedAt", null);
  }
  if (type === "Opportunity") {
    await admin.from("quotation").update({ deletedAt: stamp, updatedAt: stamp }).eq("opportunityId", id).is("deletedAt", null);
  }

  await audit(type, id, auth.user.id, null, stamp);
  revalidate(type, id);
  return { ok: true, data: undefined };
}

export async function restoreFromRecycleBin(type: RecycleType, id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse({ type, id });
  if (!parsed.success) return { ok: false, error: "That record could not be found." };
  const config = RECYCLE_TYPES[type];
  const auth = await authorize(config.permission);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = await supabaseServer();
  const { data: row } = await db.from(config.table).select("id, deletedAt, deletedById").eq("id", id).maybeSingle();
  if (!row || !row.deletedById) return { ok: false, error: "That record is not in the recycle bin." };

  const admin = supabaseAdmin();
  const stamp = row.deletedAt as string;
  const back = { deletedAt: null, deletedById: null, updatedAt: new Date().toISOString() };
  const { error } = await admin.from(config.table).update(back).eq("id", id);
  if (error) return { ok: false, error: `It could not be restored: ${error.message}` };

  if (type === "Account") {
    await admin.from("contact").update(back).eq("accountId", id).eq("deletedAt", stamp).not("deletedById", "is", null);
  }
  if (type === "Opportunity") {
    await admin.from("quotation").update({ deletedAt: null, updatedAt: back.updatedAt }).eq("opportunityId", id).eq("deletedAt", stamp);
  }

  await audit(type, id, auth.user.id, stamp, null);
  revalidate(type, id);
  return { ok: true, data: undefined };
}

export async function eraseForGood(type: RecycleType, id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse({ type, id });
  if (!parsed.success) return { ok: false, error: "That record could not be found." };
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: auth.error };
  const { error } = await supabaseAdmin().rpc("recycle_erase", { p_entity_type: type, p_id: id });
  if (error) return { ok: false, error: error.message };
  await audit(type, id, auth.user.id, "in recycle bin", "erased");
  revalidatePath("/recycle-bin");
  return { ok: true, data: undefined };
}

export interface RecycleItem {
  type: RecycleType;
  typeLabel: string;
  id: string;
  label: string;
  deletedAt: string;
  deletedByName: string | null;
  href: string;
}

/** Everything in the bin that this person may restore, newest first. */
export async function listRecycleBin(): Promise<RecycleItem[]> {
  const user = await requireUser();
  const db = await supabaseServer();
  const types = (Object.keys(RECYCLE_TYPES) as RecycleType[]).filter((t) => can(user, RECYCLE_TYPES[t].permission));
  const lists = await Promise.all(
    types.map(async (type) => {
      const config = RECYCLE_TYPES[type];
      const { data } = await db
        .from(config.table)
        .select(`id, deletedAt, deletedById, ${config.select}`)
        .not("deletedById", "is", null)
        .order("deletedAt", { ascending: false })
        .limit(200);
      return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({ type, row }));
    }),
  );
  const rows = lists.flat();
  const deleterIds = [...new Set(rows.map((r) => r.row.deletedById as string))];
  const { data: people } = deleterIds.length
    ? await supabaseAdmin().from("app_user").select("id, fullName").in("id", deleterIds)
    : { data: [] };
  const names = new Map((people ?? []).map((p) => [p.id as string, p.fullName as string]));

  return rows
    .map(({ type, row }) => ({
      type,
      typeLabel: RECYCLE_TYPES[type].label,
      id: row.id as string,
      label: recycleLabel(type, row) || "(no name)",
      deletedAt: row.deletedAt as string,
      deletedByName: names.get(row.deletedById as string) ?? null,
      href: `${RECYCLE_TYPES[type].path}${row.id}`,
    }))
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}
