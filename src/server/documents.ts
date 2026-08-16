"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { one } from "@/lib/decimal";
import type { ActionResult } from "./partners";

/**
 * Files attached to a record.
 *
 * The bucket is PRIVATE: these hold signed contracts and identity documents,
 * so a public URL would be a permanent unauthenticated link to them. Reads go
 * through a short-lived signed URL issued here, after the caller has been
 * checked — never a stored public path.
 *
 * As with notes, relatedEntityType is polymorphic with no foreign key, so it is
 * validated against a fixed list rather than trusted from the form.
 */

const BUCKET = "documents";
const MAX_BYTES = 25 * 1024 * 1024;
const SIGNED_URL_SECONDS = 300;

const ENTITY_TYPES = [
  "Account", "Contact", "Lead", "Opportunity", "Quotation", "Contract",
  "SupportCase", "Project", "Invoice", "Partner", "Campaign", "Product",
  "Expense", "VendorBill",
] as const;

/**
 * What a browser may upload.
 *
 * An allow-list, not a block-list: anything not named here is refused. Serving
 * an uploaded .html or .svg from the same origin would let it run as a page,
 * so neither is on it.
 */
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/zip",
]);

export interface DocumentRow {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  category: string | null;
  confidential: boolean;
  createdAt: string;
  uploadedById: string;
  uploadedBy: { id: string; fullName: string } | null;
  isMine: boolean;
}

export async function listDocuments(
  entityType: string,
  entityId: string,
): Promise<DocumentRow[]> {
  const me = await requireUser();
  const db = await supabaseServer();

  const { data, error } = await db
    .from("document")
    .select("*, uploadedBy:app_user!document_uploadedById_fkey ( id, fullName )")
    .eq("relatedEntityType", entityType)
    .eq("relatedEntityId", entityId)
    .is("deletedAt", null)
    .order("createdAt", { ascending: false })
    .limit(100);

  if (error) throw new Error(`Could not load documents: ${error.message}`);

  return (data ?? []).map((d) => ({
    ...d,
    uploadedBy: one(d.uploadedBy as never),
    isMine: d.uploadedById === me.id,
    fileSizeBytes: Number(d.fileSizeBytes),
  })) as DocumentRow[];
}

const uploadSchema = z.object({
  relatedEntityType: z.enum(ENTITY_TYPES),
  relatedEntityId: z.string().uuid(),
  category: z.string().max(100).optional().nullable(),
  confidential: z.coerce.boolean().default(false),
});

export async function uploadDocument(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const me = await requireUser();

  const parsed = uploadSchema.safeParse({
    relatedEntityType: formData.get("relatedEntityType"),
    relatedEntityId: formData.get("relatedEntityId"),
    category: formData.get("category"),
    confidential: formData.get("confidential") === "on",
  });

  if (!parsed.success) {
    return { ok: false, error: "That record cannot take an attachment." };
  }
  const d = parsed.data;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Choose a file to upload." };
  }

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_BYTES)}.`,
    };
  }

  if (!ALLOWED_MIME.has(file.type)) {
    return {
      ok: false,
      error: `${file.type || "That file type"} is not accepted. Documents, spreadsheets, images and PDFs are.`,
    };
  }

  // The stored path never uses the original name: a caller-supplied filename is
  // a path-traversal and collision risk, and two people uploading "contract.pdf"
  // must not overwrite each other. The display name lives in the row instead.
  const extension = file.name.includes(".") ? file.name.split(".").pop()!.slice(0, 10) : "bin";
  const storagePath = `${d.relatedEntityType}/${d.relatedEntityId}/${randomUUID()}.${extension}`;

  // Service role for the object write only. The row below goes through the
  // caller's own client, so RLS still decides whether they may attach to this
  // record; the bucket has no policies of its own.
  const storage = supabaseAdmin();

  const { error: uploadError } = await storage.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });

  if (uploadError) return { ok: false, error: `Upload failed: ${uploadError.message}` };

  const db = await supabaseServer();
  const now = new Date().toISOString();

  const { data: row, error } = await db
    .from("document")
    .insert({
      id: randomUUID(),
      updatedAt: now,
      fileName: file.name.slice(0, 255),
      storageUrl: storagePath,
      mimeType: file.type,
      fileSizeBytes: file.size,
      category: d.category || null,
      relatedEntityType: d.relatedEntityType,
      relatedEntityId: d.relatedEntityId,
      uploadedById: me.id,
      confidential: d.confidential,
    })
    .select("id")
    .single();

  if (error) {
    // The row is the record of the file. Without it the object is unreachable,
    // so it is removed rather than left orphaned in the bucket.
    await storage.storage.from(BUCKET).remove([storagePath]);
    return { ok: false, error: error.message };
  }

  revalidatePath("/", "layout");
  return { ok: true, data: { id: row.id } };
}

/**
 * A short-lived URL for one document.
 *
 * Issued per request rather than stored, so access ends with the link. The
 * caller is re-checked here: reaching this action is not proof they may read
 * the record the document hangs off.
 */
export async function getDocumentUrl(id: string): Promise<ActionResult<{ url: string }>> {
  await requireUser();
  const db = await supabaseServer();

  // Through the caller's client, so RLS decides whether the row is visible.
  const { data: doc } = await db
    .from("document")
    .select("id, fileName, storageUrl")
    .eq("id", id)
    .is("deletedAt", null)
    .maybeSingle();

  if (!doc) return { ok: false, error: "That document is not available to you." };

  const storage = supabaseAdmin();
  const { data, error } = await storage.storage
    .from(BUCKET)
    .createSignedUrl(doc.storageUrl, SIGNED_URL_SECONDS, { download: doc.fileName });

  if (error) return { ok: false, error: `Could not open the file: ${error.message}` };

  return { ok: true, data: { url: data.signedUrl } };
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  const me = await requireUser();
  const db = await supabaseServer();

  const { data: doc } = await db
    .from("document")
    .select("id, uploadedById, storageUrl")
    .eq("id", id)
    .maybeSingle();

  if (!doc) return { ok: true, data: undefined };

  if (doc.uploadedById !== me.id && !can(me, PERMISSIONS.ADMIN)) {
    return { ok: false, error: "You can only remove documents you uploaded." };
  }

  const { error } = await db
    .from("document")
    .update({ deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, error: error.message };

  // The object goes too. A soft-deleted row keeps the audit trail of what was
  // attached and by whom; keeping the file itself would keep it retrievable.
  await supabaseAdmin().storage.from(BUCKET).remove([doc.storageUrl]);

  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
