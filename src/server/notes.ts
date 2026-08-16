"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { one } from "@/lib/decimal";
import type { ActionResult } from "./partners";

/**
 * Notes attached to any record.
 *
 * note.relatedEntityType / relatedEntityId is a polymorphic link — there is no
 * foreign key, so the entity type is checked against a fixed list here rather
 * than trusted from the form. Without that a note could be filed against a
 * table name of the caller's choosing.
 *
 * Visibility is the note's own: PRIVATE is the author's alone, TEAM is the
 * default, ORGANIZATION is everyone. Enforced on read below, since notes carry
 * no RLS policy of their own beyond "internal user".
 */

const ENTITY_TYPES = [
  "Account", "Contact", "Lead", "Opportunity", "Quotation", "Contract",
  "SupportCase", "Project", "Invoice", "Partner", "Campaign", "Product",
  "Payment", "ProjectTask",
] as const;

const noteSchema = z.object({
  relatedEntityType: z.enum(ENTITY_TYPES),
  relatedEntityId: z.string().uuid(),
  title: z.string().max(255).optional().nullable(),
  content: z.string().trim().min(1, "A note needs something in it."),
  visibility: z.enum(["PRIVATE", "TEAM", "ORGANIZATION"]).default("TEAM"),
});

export interface Note {
  id: string;
  title: string | null;
  content: string;
  visibility: string;
  createdAt: string;
  createdById: string;
  createdBy: { id: string; fullName: string } | null;
  /** Whether the reader wrote this one — only then can they edit or remove it. */
  isMine: boolean;
}

export async function listNotes(
  entityType: string,
  entityId: string,
): Promise<Note[]> {
  const me = await requireUser();
  const db = await supabaseServer();

  const { data, error } = await db
    .from("note")
    .select("*, createdBy:app_user!note_createdById_fkey ( id, fullName )")
    .eq("relatedEntityType", entityType)
    .eq("relatedEntityId", entityId)
    .is("deletedAt", null)
    .order("createdAt", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Could not load notes: ${error.message}`);

  return (data ?? [])
    // A private note belongs to whoever wrote it. Filtering here rather than in
    // the query keeps the rule in one readable place.
    .filter((n) => n.visibility !== "PRIVATE" || n.createdById === me.id)
    .map((n) => ({
      ...n,
      createdBy: one(n.createdBy as never),
      isMine: n.createdById === me.id,
    })) as Note[];
}

export async function createNote(
  input: z.infer<typeof noteSchema>,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();

  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the note.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }
  const d = parsed.data;

  const db = await supabaseServer();
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("note")
    .insert({
      id: randomUUID(),
      updatedAt: now,
      relatedEntityType: d.relatedEntityType,
      relatedEntityId: d.relatedEntityId,
      title: d.title || null,
      content: d.content,
      visibility: d.visibility,
      createdById: me.id,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id } };
}

export async function updateNote(
  id: string,
  content: string,
  visibility: string,
): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();

  if (!content.trim()) return { ok: false, error: "A note needs something in it." };

  const db = await supabaseServer();

  const { data: existing } = await db
    .from("note")
    .select("id, createdById")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return { ok: false, error: "That note no longer exists." };
  if (existing.createdById !== me.id) {
    return { ok: false, error: "You can only edit your own notes." };
  }

  const { error } = await db
    .from("note")
    .update({ content: content.trim(), visibility, updatedAt: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function deleteNote(id: string): Promise<ActionResult> {
  const me = await requireUser();
  const db = await supabaseServer();

  const { data: existing } = await db
    .from("note")
    .select("id, createdById")
    .eq("id", id)
    .maybeSingle();

  if (!existing) return { ok: true, data: undefined };

  // An administrator can remove anyone's note; everyone else only their own.
  if (existing.createdById !== me.id && !can(me, PERMISSIONS.ADMIN)) {
    return { ok: false, error: "You can only remove your own notes." };
  }

  // Soft delete, matching every other record in the system — a note is often
  // the only account of why something was done.
  const { error } = await db
    .from("note")
    .update({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
