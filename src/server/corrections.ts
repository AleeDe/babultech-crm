"use server";

import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { authorize, requireUser, can, PERMISSIONS } from "@/lib/authz";
import { CORRECTABLE, CORRECTION_MINUTES, isCorrectable, type CorrectableType } from "@/lib/corrections";
import type { ActionResult } from "./partners";

/**
 * Correcting a processed record (lib/corrections.ts says when one is).
 *
 * Before processing, the usual permissions decide. After it, only an
 * administrator may change or delete the record, and a change needs a
 * correction opened with a reason first. Every edit action calls editGate()
 * before saving and markCorrectionSaved() after, so the rule lives in one
 * place rather than in each form.
 */

export interface CorrectionState {
  /** Why it counts as processed, or null. */
  processed: string | null;
  isAdmin: boolean;
  open: { id: string; reason: string; openedByName: string | null; expiresAt: string } | null;
  wordingOnly: boolean;
}

async function readRow(type: CorrectableType, id: string): Promise<Record<string, unknown> | null> {
  const kind = CORRECTABLE[type];
  // Visible to this person first, through their own session.
  const db = await supabaseServer();
  const { data: seen } = await db.from(kind.table as string).select("id").eq("id", id).maybeSingle();
  if (!seen) return null;
  const { data } = await supabaseAdmin().from(kind.table as string).select(`id, ${kind.columns}`).eq("id", id).maybeSingle();
  return (data as Record<string, unknown> | null) ?? null;
}

async function openCorrectionFor(type: CorrectableType, id: string) {
  const { data } = await supabaseAdmin()
    .from("record_correction")
    .select("id, reason, openedById, expiresAt")
    .eq("entityType", type)
    .eq("entityId", id)
    .is("savedAt", null)
    .gt("expiresAt", new Date().toISOString())
    .order("openedAt", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; reason: string; openedById: string; expiresAt: string } | null;
}

export async function getCorrectionState(type: string, id: string): Promise<CorrectionState | null> {
  if (!isCorrectable(type)) return null;
  const me = await requireUser();
  const row = await readRow(type, id);
  if (!row) return null;
  const processed = CORRECTABLE[type].processed(row);
  const isAdmin = can(me, PERMISSIONS.ADMIN);
  let open: CorrectionState["open"] = null;
  if (processed && isAdmin) {
    const c = await openCorrectionFor(type, id);
    if (c) {
      const { data: who } = await supabaseAdmin().from("app_user").select("fullName").eq("id", c.openedById).maybeSingle();
      // The column holds UTC without a zone; say so before anyone formats it.
      const expiresAt = /[zZ]|[+-]\d\d:?\d\d$/.test(c.expiresAt) ? c.expiresAt : `${c.expiresAt}Z`;
      open = { id: c.id, reason: c.reason, openedByName: (who?.fullName as string) ?? null, expiresAt };
    }
  }
  return { processed, isAdmin, open, wordingOnly: Boolean((CORRECTABLE[type] as { wordingOnly?: boolean }).wordingOnly) };
}

const openSchema = z.object({
  type: z.string(),
  id: z.string().uuid(),
  reason: z.string().trim().min(5, "Say in a few words what was wrong.").max(1000),
});

/** An administrator opens a correction on a processed record. */
export async function openCorrection(input: z.infer<typeof openSchema>): Promise<ActionResult<{ editPath: string }>> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: "Only an administrator can correct a record once it has been processed." };
  const parsed = openSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Give a reason." };
  const { type, id, reason } = parsed.data;
  if (!isCorrectable(type)) return { ok: false, error: "That kind of record is not corrected this way." };
  const kind = CORRECTABLE[type];
  const row = await readRow(type, id);
  if (!row) return { ok: false, error: "That record could not be found." };
  if (!kind.processed(row)) return { ok: true, data: { editPath: kind.editPath(id) } }; // Nothing to unlock.

  const admin = supabaseAdmin();
  const expiresAt = new Date(Date.now() + CORRECTION_MINUTES * 60_000).toISOString();
  const { error } = await admin.from("record_correction").insert({ entityType: type, entityId: id, reason, openedById: auth.user.id, expiresAt });
  if (error) return { ok: false, error: error.message };
  await admin.from("audit_history").insert({
    id: crypto.randomUUID(), entityType: type, entityId: id, fieldName: "correction", oldValue: null,
    newValue: `Correction opened: ${reason}`, changedById: auth.user.id, source: "UI", changedAt: new Date().toISOString(),
  });

  // The owner hears about it, unless they are the one correcting it.
  const owner = kind.ownerColumn ? (row[kind.ownerColumn] as string | null) : null;
  if (owner && owner !== auth.user.id) {
    await admin.rpc("notify_user", {
      p_user: owner,
      p_kind: "RECORD_CORRECTED",
      p_title: `${auth.user.fullName} is correcting your ${kind.label}`,
      p_body: reason,
      p_link: kind.editPath(id).replace(/\/edit$/, ""),
      p_entity_type: type,
      p_entity_id: id,
    });
  }
  return { ok: true, data: { editPath: kind.editPath(id) } };
}

/**
 * Whether the person may save changes to this record now. Called by every
 * edit action before it writes.
 */
export async function editGate(type: CorrectableType, id: string): Promise<{ ok: true; correctionId: string | null; wordingOnly: boolean } | { ok: false; error: string }> {
  const me = await requireUser();
  const kind = CORRECTABLE[type];
  const { data: row } = await supabaseAdmin().from(kind.table as string).select(`id, ${kind.columns}`).eq("id", id).maybeSingle();
  if (!row) return { ok: false, error: "That record could not be found." };
  const processed = kind.processed(row as unknown as Record<string, unknown>);
  if (!processed) return { ok: true, correctionId: null, wordingOnly: false };
  if (!can(me, PERMISSIONS.ADMIN)) {
    return { ok: false, error: `${processed} Only an administrator can change this ${kind.label} now.` };
  }
  const open = await openCorrectionFor(type, id);
  if (!open) return { ok: false, error: `${processed} Press Correct on the ${kind.label} and say why before changing it.` };
  return { ok: true, correctionId: open.id, wordingOnly: Boolean((kind as { wordingOnly?: boolean }).wordingOnly) };
}

export async function markCorrectionSaved(correctionId: string | null): Promise<void> {
  if (!correctionId) return;
  await supabaseAdmin().from("record_correction").update({ savedAt: new Date().toISOString() }).eq("id", correctionId);
}

/** Before deleting: a processed record is an administrator's to delete. */
export async function deleteGate(type: string, id: string): Promise<string | null> {
  if (!isCorrectable(type)) return null;
  const me = await requireUser();
  if (can(me, PERMISSIONS.ADMIN)) return null;
  const kind = CORRECTABLE[type];
  const { data: row } = await supabaseAdmin().from(kind.table as string).select(`id, ${kind.columns}`).eq("id", id).maybeSingle();
  const processed = row ? kind.processed(row as unknown as Record<string, unknown>) : null;
  return processed ? `${processed} Only an administrator can delete this ${kind.label} now.` : null;
}

const WORDING: Record<string, { table: string; fields: Record<string, "date" | "text" | "int"> }> = {
  Invoice: { table: "invoice", fields: { dueDate: "date", paymentTermsDays: "int", notes: "text" } },
  Quotation: { table: "quotation", fields: { expiryDate: "date", paymentTerms: "text", notes: "text", termsAndConditions: "text" } },
};

/**
 * Corrects the wording, dates and references of a document the customer
 * already holds - an issued invoice or a sent quote. Its amounts and lines are
 * never touched here.
 */
export async function correctDocumentWording(input: { type: "Invoice" | "Quotation"; id: string; values: Record<string, string> }): Promise<ActionResult> {
  const auth = await authorize(PERMISSIONS.ADMIN);
  if (!auth.ok) return { ok: false, error: "Only an administrator can correct it." };
  const spec = WORDING[input.type];
  if (!spec || !z.string().uuid().safeParse(input.id).success) return { ok: false, error: "That record could not be found." };
  const gate = await editGate(input.type, input.id);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (!gate.correctionId) return { ok: false, error: "Edit it in the usual way: it has not been issued yet." };

  const admin = supabaseAdmin();
  const { data: before } = await admin.from(spec.table).select(Object.keys(spec.fields).join(", ")).eq("id", input.id).maybeSingle();
  if (!before) return { ok: false, error: "That record could not be found." };
  const old = before as unknown as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(spec.fields)) {
    if (!(key in input.values)) continue;
    const raw = String(input.values[key] ?? "").trim();
    let value: unknown = raw || null;
    if (kind === "int" && raw) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 3650) return { ok: false, error: "Payment terms are a whole number of days." };
      value = n;
    }
    if (kind === "date" && raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, error: "Enter dates as a date." };
    if (String(old[key] ?? "") !== String(value ?? "")) patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing was changed." };

  const { error } = await admin.from(spec.table).update({ ...patch, updatedAt: new Date().toISOString() }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await admin.from("audit_history").insert(
    Object.entries(patch).map(([key, value]) => ({
      id: crypto.randomUUID(), entityType: input.type, entityId: input.id, fieldName: key,
      oldValue: old[key] == null ? null : String(old[key]), newValue: value == null ? null : String(value),
      changedById: auth.user.id, source: "UI", changedAt: new Date().toISOString(),
    })),
  );
  await markCorrectionSaved(gate.correctionId);
  return { ok: true, data: undefined };
}
