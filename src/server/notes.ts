"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { one } from "@/lib/decimal";
import { extractMentions } from "@/lib/mentions";
import { notifyMentioned } from "./note-notifications";
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
  "Expense", "VendorBill",
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
  /** Files and images on this note, each with a short-lived signed URL. */
  attachments: NoteAttachment[];
  /** People named with @, for showing who has been pulled in. */
  mentions: { id: string; fullName: string }[];
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

  const visible = (data ?? [])
    // A private note belongs to whoever wrote it. Filtering here rather than in
    // the query keeps the rule in one readable place.
    .filter((n) => n.visibility !== "PRIVATE" || n.createdById === me.id);

  if (visible.length === 0) return [];

  const noteIds = visible.map((n) => String(n.id));

  // Attachments and mentions in two queries for the whole page rather than two
  // per note: a record with twenty notes was otherwise forty round trips.
  const [attachRes, mentionRes] = await Promise.all([
    db
      .from("note_attachment")
      .select("id, noteId, fileName, mimeType, fileSizeBytes, storagePath, isImage, createdAt, uploadedById")
      .in("noteId", noteIds)
      .order("createdAt"),
    db
      .from("note_mention")
      .select("noteId, userId, user:app_user!note_mention_userId_fkey ( id, fullName )")
      .in("noteId", noteIds),
  ]);

  const attachRows = (attachRes.data ?? []) as Record<string, any>[];

  // Signed once for the whole page. The bucket is private, so nothing has a
  // usable address until this runs, and the URLs expire in minutes.
  const urls = await signAttachments(
    attachRows.map((a) => ({ id: String(a.id), storagePath: String(a.storagePath) })),
  );

  const attachmentsByNote = new Map<string, NoteAttachment[]>();
  for (const a of attachRows) {
    const key = String(a.noteId);
    const list = attachmentsByNote.get(key) ?? [];
    list.push({
      id: String(a.id),
      fileName: String(a.fileName),
      mimeType: String(a.mimeType),
      fileSizeBytes: Number(a.fileSizeBytes ?? 0),
      isImage: Boolean(a.isImage),
      createdAt: String(a.createdAt),
      uploadedById: String(a.uploadedById),
      url: urls.get(String(a.id)) ?? null,
    });
    attachmentsByNote.set(key, list);
  }

  const mentionsByNote = new Map<string, { id: string; fullName: string }[]>();
  for (const m of (mentionRes.data ?? []) as Record<string, any>[]) {
    const person = one(m.user as never) as { id: string; fullName: string } | null;
    if (!person) continue;
    const key = String(m.noteId);
    mentionsByNote.set(key, [...(mentionsByNote.get(key) ?? []), person]);
  }

  return visible.map((n) => ({
    ...n,
    createdBy: one(n.createdBy as never),
    isMine: n.createdById === me.id,
    attachments: attachmentsByNote.get(String(n.id)) ?? [],
    mentions: mentionsByNote.get(String(n.id)) ?? [],
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

  // After the note exists, so a failed notification can never lose it.
  await syncMentions(data.id, d.content, me.id, {
    entityType: d.relatedEntityType,
    entityId: d.relatedEntityId,
  });

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
    .select("id, createdById, relatedEntityType, relatedEntityId")
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

  // An edit that adds a name notifies only that person; one that removes a name
  // drops the row. Nobody already told is told again.
  await syncMentions(id, content.trim(), me.id, {
    entityType: String(existing.relatedEntityType),
    entityId: String(existing.relatedEntityId),
  });

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

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

/**
 * Files attached to a note live in their own PRIVATE bucket.
 *
 * Separate from `documents` on purpose: a document is a record-level artefact
 * with a category and a confidentiality flag, kept for as long as the record
 * lives. A note attachment is evidence for one comment and dies with it.
 * Sharing a bucket would put every pasted screenshot into the formal document
 * list of the account.
 */
const NOTE_BUCKET = "note-attachments";
const NOTE_MAX_BYTES = 10 * 1024 * 1024;
const NOTE_SIGNED_URL_SECONDS = 300;

/**
 * What may be attached. An allow-list, not a block-list.
 *
 * SVG is deliberately absent even though it is an image: an SVG served from
 * our own origin can carry script. So is HTML, for the same reason. This
 * mirrors the choice already made for documents.
 */
const NOTE_ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/zip",
]);

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export interface NoteAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  isImage: boolean;
  createdAt: string;
  uploadedById: string;
  /** Short-lived signed URL. Null when the object could not be signed. */
  url: string | null;
}

/**
 * Someone who can be @mentioned.
 *
 * Only active internal colleagues: mentioning a deactivated account or an
 * external partner login would notify a mailbox nobody reads, and partners
 * cannot open the record the note is on anyway.
 */
export interface MentionableUser {
  id: string;
  fullName: string;
  jobTitle: string | null;
}

export async function listMentionableUsers(): Promise<MentionableUser[]> {
  await requireUser();
  const db = await supabaseServer();

  const { data, error } = await db
    .from("app_user")
    .select("id, fullName, jobTitle")
    .eq("status", "ACTIVE")
    .is("deletedAt", null)
    .is("partnerId", null)
    .order("fullName")
    .limit(500);

  if (error) return [];
  return (data ?? []) as MentionableUser[];
}

/**
 * Attach a file to a note.
 *
 * The note is re-read rather than trusted from the form: only its author may
 * add to it, and that has to be decided against the stored row.
 */
export async function attachToNote(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();

  const noteId = String(formData.get("noteId") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) {
    return { ok: false, error: "That note no longer exists." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to attach." };
  }

  if (file.size > NOTE_MAX_BYTES) {
    return {
      ok: false,
      error: `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${NOTE_MAX_BYTES / 1024 / 1024}MB.`,
    };
  }

  if (!NOTE_ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `${file.type || "That file type"} cannot be attached. Images, PDFs, Office files and text are accepted.`,
    };
  }

  const db = await supabaseServer();

  const { data: note } = await db
    .from("note")
    .select("id, createdById, deletedAt")
    .eq("id", noteId)
    .maybeSingle();

  if (!note || note.deletedAt) return { ok: false, error: "That note no longer exists." };
  if (note.createdById !== me.id) {
    return { ok: false, error: "You can only attach files to your own notes." };
  }

  // The stored object is named by a uuid, never by the uploaded filename: a
  // caller-supplied name is a path-traversal and collision risk, and two people
  // attaching "screenshot.png" must not overwrite one another. The display name
  // lives in the row.
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.slice(0, 10) : "bin";
  const storagePath = `${noteId}/${randomUUID()}.${extension}`;

  // Service role for the object write only. The row below goes through the
  // caller's own client, so RLS still applies to it.
  const storage = supabaseAdmin();
  const { error: uploadError } = await storage.storage
    .from(NOTE_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) return { ok: false, error: `Upload failed: ${uploadError.message}` };

  const { data: row, error } = await db
    .from("note_attachment")
    .insert({
      id: randomUUID(),
      noteId,
      fileName: file.name.slice(0, 255),
      mimeType: file.type,
      fileSizeBytes: file.size,
      storagePath,
      isImage: IMAGE_MIME.has(file.type),
      uploadedById: me.id,
    })
    .select("id")
    .single();

  if (error) {
    // The object is already in the bucket but nothing points at it now, so it
    // is removed rather than left orphaned.
    await storage.storage.from(NOTE_BUCKET).remove([storagePath]);
    return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { id: row.id } };
}

export async function removeNoteAttachment(id: string): Promise<ActionResult> {
  const me = await requireUser();
  const db = await supabaseServer();

  const { data: row } = await db
    .from("note_attachment")
    .select("id, uploadedById, storagePath")
    .eq("id", id)
    .maybeSingle();

  if (!row) return { ok: true, data: undefined };
  if (row.uploadedById !== me.id && !can(me, PERMISSIONS.ADMIN)) {
    return { ok: false, error: "You can only remove your own attachments." };
  }

  const { error } = await db.from("note_attachment").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };

  // The row is gone either way; a failure here leaves an unreferenced object
  // rather than a broken attachment, which is the better of the two.
  await supabaseAdmin().storage.from(NOTE_BUCKET).remove([row.storagePath]);

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/**
 * Signed URLs for a batch of attachments.
 *
 * The bucket is private, so nothing has a usable address until it is signed.
 * Signing happens after the caller has passed the note's own visibility check
 * in listNotes, and the URLs expire in minutes — a link copied out of the page
 * stops working rather than becoming a permanent unauthenticated door.
 */
async function signAttachments(
  rows: { id: string; storagePath: string }[],
): Promise<Map<string, string>> {
  if (rows.length === 0) return new Map();

  const storage = supabaseAdmin();
  const { data } = await storage.storage
    .from(NOTE_BUCKET)
    .createSignedUrls(rows.map((r) => r.storagePath), NOTE_SIGNED_URL_SECONDS);

  const byPath = new Map((data ?? []).map((d) => [d.path, d.signedUrl]));
  const out = new Map<string, string>();
  for (const r of rows) {
    const url = byPath.get(r.storagePath);
    if (url) out.set(r.id, url);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

/**
 * Record who a note names, and tell them.
 *
 * Ids come out of the note text, so they are checked against the real user list
 * before anything is written — someone hand-editing a token to name an id they
 * invented gets no row and no email.
 *
 * Mentioning yourself is ignored: a notification telling you what you just
 * wrote is noise.
 *
 * Notification failure must not fail the note. Someone has written down what
 * happened; losing that because a mail server was unreachable would be the
 * wrong trade, so the send is attempted and its outcome recorded in
 * `notifiedAt` rather than thrown.
 */
async function syncMentions(
  noteId: string,
  content: string,
  authorId: string,
  context: { entityType: string; entityId: string },
): Promise<void> {
  const mentioned = extractMentions(content);
  const db = await supabaseServer();

  // Everyone currently recorded against this note, so an edit that removes a
  // name removes the row, and one that adds a name does not re-notify the rest.
  const { data: existing } = await db
    .from("note_mention")
    .select("id, userId, notifiedAt")
    .eq("noteId", noteId);

  const existingByUser = new Map((existing ?? []).map((r) => [String(r.userId), r]));
  const wantedIds = new Set(mentioned.map((m) => m.id).filter((id) => id !== authorId));

  // Only real, active, internal people. A token naming anyone else resolves to
  // nothing rather than a row.
  const valid = wantedIds.size
    ? ((
        await db
          .from("app_user")
          .select("id, fullName")
          .in("id", [...wantedIds])
          .eq("status", "ACTIVE")
          .is("deletedAt", null)
          .is("partnerId", null)
      ).data ?? [])
    : [];

  const validIds = new Set(valid.map((u) => String(u.id)));

  // Remove mentions that are no longer in the text.
  const stale = (existing ?? []).filter((r) => !validIds.has(String(r.userId)));
  if (stale.length) {
    await db.from("note_mention").delete().in("id", stale.map((r) => r.id));
  }

  // Add the new ones.
  const fresh = valid.filter((u) => !existingByUser.has(String(u.id)));
  if (fresh.length === 0) return;

  const { data: inserted } = await db
    .from("note_mention")
    .insert(fresh.map((u) => ({ id: randomUUID(), noteId, userId: String(u.id) })))
    .select("id, userId");

  if (!inserted?.length) return;

  // Told after the rows exist, so a crash mid-send leaves a mention that can be
  // retried rather than an email with nothing behind it.
  try {
    const notified = await notifyMentioned({
      noteId,
      content,
      authorId,
      recipientIds: inserted.map((r) => String(r.userId)),
      ...context,
    });

    if (notified.length) {
      await db
        .from("note_mention")
        .update({ notifiedAt: new Date().toISOString() })
        .eq("noteId", noteId)
        .in("userId", notified);
    }
  } catch {
    // Left with notifiedAt null: the mention stands, the person simply has not
    // been told. Better than losing the note.
  }
}
