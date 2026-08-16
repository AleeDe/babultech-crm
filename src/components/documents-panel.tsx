"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, Trash2, Download, FileText, Image as ImageIcon, Lock } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardContent, Input, Button, Alert, Badge,
} from "@/components/ui";
import {
  uploadDocument, deleteDocument, getDocumentUrl, type DocumentRow,
} from "@/server/documents";
import { formatDateTime } from "@/lib/utils";

/**
 * Files on a record.
 *
 * Downloads go through a server action that mints a short-lived signed URL —
 * the bucket is private, so there is no permanent link to store or leak. The
 * URL is opened as soon as it comes back and never held.
 */
export function DocumentsPanel({
  entityType,
  entityId,
  documents,
}: {
  entityType: string;
  entityId: string;
  documents: DocumentRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  function upload(formData: FormData) {
    setError(null);
    formData.set("relatedEntityType", entityType);
    formData.set("relatedEntityId", entityId);

    start(async () => {
      const result = await uploadDocument(formData);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function remove(id: string) {
    setError(null);
    start(async () => {
      const result = await deleteDocument(id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function open(id: string) {
    setError(null);
    setOpening(id);
    start(async () => {
      const result = await getDocumentUrl(id);
      setOpening(null);
      if (result.ok) window.open(result.data.url, "_blank", "noopener,noreferrer");
      else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Paperclip className="h-4 w-4 text-muted-foreground" />
          Documents
          {documents.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({documents.length})</span>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <form action={upload} className="space-y-2 rounded-lg border border-dashed bg-muted/20 p-3">
          <Input
            type="file"
            name="file"
            required
            className="cursor-pointer text-xs file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Input
                name="category"
                placeholder="Category (optional)"
                className="h-8 w-40 text-xs"
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" name="confidential" /> Confidential
              </label>
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Uploading…" : "Upload"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            PDFs, documents, spreadsheets and images. Up to 25 MB.
          </p>
        </form>

        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing attached yet.</p>
        ) : (
          <ul className="divide-y">
            {documents.map((doc) => {
              const isImage = doc.mimeType.startsWith("image/");
              const Icon = isImage ? ImageIcon : FileText;

              return (
                <li key={doc.id} className="flex items-center gap-3 py-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => open(doc.id)}
                      disabled={pending}
                      className="max-w-full truncate text-left text-sm font-medium hover:underline disabled:opacity-50"
                    >
                      {opening === doc.id ? "Opening…" : doc.fileName}
                    </button>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>{formatBytes(doc.fileSizeBytes)}</span>
                      <span>·</span>
                      <span>{doc.uploadedBy?.fullName ?? "Unknown"}</span>
                      <span>·</span>
                      <span>{formatDateTime(doc.createdAt)}</span>
                    </p>
                  </div>

                  {doc.category && <Badge tone="neutral">{doc.category}</Badge>}
                  {doc.confidential && (
                    <Badge tone="warning">
                      <Lock className="h-3 w-3" /> Confidential
                    </Badge>
                  )}

                  <button
                    onClick={() => open(doc.id)}
                    disabled={pending}
                    aria-label={`Download ${doc.fileName}`}
                    className="shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  >
                    <Download className="h-4 w-4" />
                  </button>

                  {doc.isMine && (
                    <button
                      onClick={() => remove(doc.id)}
                      disabled={pending}
                      aria-label={`Remove ${doc.fileName}`}
                      className="shrink-0 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
