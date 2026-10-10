"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { authorize, requireUser, can, PERMISSIONS } from "@/lib/authz";
import { RECYCLE_TYPES, isServiceOnly, recycleLabel, type RecycleType } from "@/lib/recycle-types";
import type { ActionResult } from "./partners";

/**
 * Deleting to the recycle bin, restoring, and erasing for good.
 *
 * Only the Super Admin deletes (record:delete), and can delete a record of any
 * kind whatever its status or stage. It still goes to the recycle bin, with
 * what belongs only to it, for 90 days. The books are the one limit:
 * recycle_hard_blocker() keeps anything dated in a closed month or tied by a
 * payment allocation (20261010000001_super_admin_deletes.sql). Every delete
 * asks why, and the reason is kept in the record's history.
 */

const idSchema = z.object({ type: z.enum(Object.keys(RECYCLE_TYPES) as [RecycleType, ...RecycleType[]]), id: z.string().uuid() });

async function audit(type: RecycleType, id: string, userId: string, oldValue: string | null, newValue: string | null, reason?: string | null) {
  const at = new Date().toISOString();
  const rows = [{ id: crypto.randomUUID(), entityType: type, entityId: id, fieldName: "deletedAt", oldValue, newValue, changedById: userId, source: "UI", changedAt: at }];
  if (reason) rows.push({ id: crypto.randomUUID(), entityType: type, entityId: id, fieldName: "deleteReason", oldValue: null, newValue: reason, changedById: userId, source: "UI", changedAt: at });
  await supabaseAdmin().from("audit_history").insert(rows);
}

async function hardBlocker(type: RecycleType, id: string): Promise<string | null> {
  const { data } = await supabaseAdmin().rpc("recycle_hard_blocker", { p_entity_type: type, p_id: id });
  return (data as string | null) ?? null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What a delete would take with it, and what it leaves, for the confirmation.
 * Only the Super Admin asks.
 */
export async function deleteImpact(type: RecycleType, id: string): Promise<{ goesWith: string[]; staysBehind: string[]; blocker: string | null }> {
  const parsed = idSchema.safeParse({ type, id });
  if (!parsed.success) return { goesWith: [], staysBehind: [], blocker: "That record could not be found." };
  const auth = await authorize(PERMISSIONS.RECORD_DELETE);
  if (!auth.ok) return { goesWith: [], staysBehind: [], blocker: auth.error };
  const admin = supabaseAdmin();
  const count = async (table: string, column: string, value: string | string[], extra?: (q: any) => any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    let q = admin.from(table).select("id", { count: "exact", head: true });
    q = Array.isArray(value) ? q.in(column, value.length ? value : ["00000000-0000-0000-0000-000000000000"]) : q.eq(column, value);
    if (extra) q = extra(q);
    const { count: n } = await q;
    return n ?? 0;
  };
  const live = (q: any) => q.is("deletedAt", null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const goesWith: string[] = [];
  const staysBehind: string[] = [];
  if (type === "Account") {
    const { data: deals } = await admin.from("opportunity").select("id").eq("accountId", id).is("deletedAt", null);
    const dealIds = (deals ?? []).map((d) => d.id as string);
    const [contacts, cases, quotes, projects, invoices, payments] = await Promise.all([
      count("contact", "accountId", id, live), count("support_case", "accountId", id, live),
      count("quotation", "opportunityId", dealIds, live), count("project", "accountId", id, live),
      count("invoice", "accountId", id, live), count("payment", "accountId", id, live),
    ]);
    if (contacts) goesWith.push(plural(contacts, "contact"));
    if (dealIds.length) goesWith.push(plural(dealIds.length, "deal"));
    if (quotes) goesWith.push(plural(quotes, "quote"));
    if (cases) goesWith.push(plural(cases, "support case"));
    if (projects) staysBehind.push(`${plural(projects, "project")}, still linked to the account`);
    if (invoices) staysBehind.push(`${plural(invoices, "invoice")}, kept for the books`);
    if (payments) staysBehind.push(`${plural(payments, "payment")}, kept for the books`);
  } else if (type === "Opportunity") {
    const [quotes, projects, invoices] = await Promise.all([
      count("quotation", "opportunityId", id, live), count("project", "opportunityId", id, live), count("invoice", "opportunityId", id, live),
    ]);
    if (quotes) goesWith.push(plural(quotes, "quote"));
    if (projects) staysBehind.push(`${plural(projects, "project")}, kept`);
    if (invoices) staysBehind.push(`${plural(invoices, "invoice")}, kept for the books`);
  } else if (type === "StaffProfile") {
    const contracts = await count("employment_contract", "staffId", id, live);
    if (contracts) goesWith.push(plural(contracts, "contract"));
    staysBehind.push("Their CRM login, which is only ever switched off");
  } else if (type === "Project") {
    const [tasks, invoices] = await Promise.all([count("project_task", "projectId", id), count("invoice", "projectId", id, live)]);
    if (tasks) goesWith.push(`${plural(tasks, "task")}, hidden with the project`);
    if (invoices) staysBehind.push(`${plural(invoices, "invoice")}, kept for the books`);
  }
  return { goesWith, staysBehind, blocker: await hardBlocker(type, id) };
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
  const db = supabaseAdmin();
  const { data } = await db.from(config.table).select("deletedAt, deletedById").eq("id", id).maybeSingle();
  const deleted = Boolean(data?.deletedAt && data?.deletedById);
  if (deleted) return { deleted, blocker: null, canDelete };
  return { deleted, blocker: await hardBlocker(type, id), canDelete };
}

export async function deleteToRecycleBin(type: RecycleType, id: string, reason?: string | null): Promise<ActionResult> {
  const parsed = idSchema.safeParse({ type, id });
  if (!parsed.success) return { ok: false, error: "That record could not be found." };
  const config = RECYCLE_TYPES[type];
  const auth = await authorize(config.permission);
  if (!auth.ok) return { ok: false, error: auth.error };

  const why = (reason ?? "").trim().slice(0, 500);
  const admin = supabaseAdmin();
  const { data: seen } = await admin.from(config.table).select("id, deletedAt").eq("id", id).maybeSingle();
  if (!seen) return { ok: false, error: "That record could not be found." };
  if (seen.deletedAt) return { ok: false, error: "It is already deleted." };

  // Whatever its status or stage; only the books hold it back.
  const blocker = await hardBlocker(type, id);
  if (blocker) return { ok: false, error: `It cannot be deleted: ${blocker}` };

  const stamp = new Date().toISOString();
  const hide = { deletedAt: stamp, deletedById: auth.user.id, updatedAt: stamp };
  const { error } = await admin.from(config.table).update(hide).eq("id", id).is("deletedAt", null);
  if (error) return { ok: false, error: error.message };

  // What belongs only to it goes with it, stamped the same so a restore
  // brings exactly that back.
  if (type === "Account") {
    await admin.from("contact").update(hide).eq("accountId", id).is("deletedAt", null);
    await admin.from("support_case").update(hide).eq("accountId", id).is("deletedAt", null);
    const { data: deals } = await admin.from("opportunity").select("id").eq("accountId", id).is("deletedAt", null);
    const dealIds = (deals ?? []).map((d) => d.id as string);
    if (dealIds.length) {
      await admin.from("opportunity").update(hide).in("id", dealIds);
      await admin.from("quotation").update({ deletedAt: stamp, updatedAt: stamp }).in("opportunityId", dealIds).is("deletedAt", null);
    }
  }
  if (type === "Opportunity") {
    await admin.from("quotation").update({ deletedAt: stamp, updatedAt: stamp }).eq("opportunityId", id).is("deletedAt", null);
  }
  // A signing link out for one of their contracts stops working.
  if (type === "EmploymentContract") {
    await admin.from("employment_contract").update({ signTokenHash: null, signTokenExpiresAt: null }).eq("id", id);
  }
  if (type === "StaffProfile") {
    await admin.from("employment_contract").update({ signTokenHash: null, signTokenExpiresAt: null, updatedAt: stamp }).eq("staffId", id).not("signTokenHash", "is", null);
  }

  await audit(type, id, auth.user.id, null, stamp, why || null);
  revalidate(type, id);
  return { ok: true, data: undefined };
}

export async function restoreFromRecycleBin(type: RecycleType, id: string): Promise<ActionResult> {
  const parsed = idSchema.safeParse({ type, id });
  if (!parsed.success) return { ok: false, error: "That record could not be found." };
  const config = RECYCLE_TYPES[type];
  const auth = await authorize(config.permission);
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = supabaseAdmin();
  const { data: row } = await db.from(config.table).select("id, deletedAt, deletedById").eq("id", id).maybeSingle();
  if (!row || !row.deletedById) return { ok: false, error: "That record is not in the recycle bin." };

  const admin = supabaseAdmin();
  const stamp = row.deletedAt as string;
  const back = { deletedAt: null, deletedById: null, updatedAt: new Date().toISOString() };
  const { error } = await admin.from(config.table).update(back).eq("id", id);
  if (error) return { ok: false, error: `It could not be restored: ${error.message}` };

  if (type === "Account") {
    await admin.from("contact").update(back).eq("accountId", id).eq("deletedAt", stamp).not("deletedById", "is", null);
    await admin.from("support_case").update(back).eq("accountId", id).eq("deletedAt", stamp).not("deletedById", "is", null);
    const { data: deals } = await admin.from("opportunity").select("id").eq("accountId", id).eq("deletedAt", stamp);
    const dealIds = (deals ?? []).map((d) => d.id as string);
    if (dealIds.length) {
      await admin.from("opportunity").update(back).in("id", dealIds);
      await admin.from("quotation").update({ deletedAt: null, updatedAt: back.updatedAt }).in("opportunityId", dealIds).eq("deletedAt", stamp);
    }
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
  const auth = await authorize(PERMISSIONS.RECORD_DELETE);
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
  /** The record's own page, for the kinds whose page still opens once deleted. */
  href: string | null;
}

/** Everything in the bin that this person may restore, newest first. */
export async function listRecycleBin(): Promise<RecycleItem[]> {
  const user = await requireUser();
  const db = await supabaseServer();
  const types = (Object.keys(RECYCLE_TYPES) as RecycleType[]).filter((t) => can(user, RECYCLE_TYPES[t].permission));
  const lists = await Promise.all(
    types.map(async (type) => {
      const config = RECYCLE_TYPES[type];
      const reader = supabaseAdmin();
      const { data } = await reader
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
      href: RECYCLE_TYPES[type].opensWhenDeleted ? `${RECYCLE_TYPES[type].path}${row.id}` : null,
    }))
    .sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
}
