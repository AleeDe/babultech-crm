"use client";

import Link from "next/link";
import { useState } from "react";
import { FileText, Download, X, Paperclip } from "lucide-react";
import { parseNoteSegments } from "@/lib/mentions";
import { cn } from "@/lib/utils";

export interface NoteAttachmentView {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  isImage: boolean;
  url: string | null;
}

/**
 * A note's text, with mentions rendered as links.
 *
 * Built from segments rather than an HTML string, so every piece of what a
 * person typed goes through React as a text node. Nothing here is passed to
 * `dangerouslySetInnerHTML`, which means a note cannot become markup no matter
 * what is typed or pasted into it — the mention token is the only thing with
 * any structure, and it resolves to a `<Link>` with an escaped name.
 */
export function NoteBody({ content }: { content: string }) {
  const segments = parseNoteSegments(content);

  return (
    <p className="whitespace-pre-wrap text-sm">
      {segments.map((s, i) =>
        s.kind === "text" ? (
          <span key={i}>{s.value}</span>
        ) : (
          <Link
            key={i}
            href={`/users/${s.id}`}
            className="rounded bg-primary/10 px-1 font-medium text-primary hover:underline"
          >
            @{s.name}
          </Link>
        ),
      )}
    </p>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * The files on a note.
 *
 * Images preview inline, because the whole point of attaching a screenshot is
 * that somebody sees it without a download step. Everything else is a chip that
 * says what it is and how big, so nobody downloads a 9MB file to find out.
 *
 * Every URL here is short-lived and signed — the bucket is private — so a
 * preview that has been open for a long time may need the page reloaded. That
 * is the intended trade: a permanent public link to a customer's document is
 * the thing being avoided.
 */
export function NoteAttachments({
  attachments,
  onRemove,
  canRemove,
}: {
  attachments: NoteAttachmentView[];
  onRemove?: (id: string) => void;
  canRemove?: boolean;
}) {
  const [lightbox, setLightbox] = useState<NoteAttachmentView | null>(null);

  if (attachments.length === 0) return null;

  const images = attachments.filter((a) => a.isImage && a.url);
  const files = attachments.filter((a) => !a.isImage || !a.url);

  return (
    <>
      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((a) => (
            <div key={a.id} className="group relative">
              <button
                type="button"
                onClick={() => setLightbox(a)}
                className="block overflow-hidden rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={`${a.fileName} · ${formatBytes(a.fileSizeBytes)}`}
              >
                {/* A plain <img>: these are signed, short-lived URLs on a
                    private bucket, which next/image cannot cache or optimise. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url!}
                  alt={a.fileName}
                  className="h-28 w-auto max-w-[14rem] object-cover"
                />
              </button>
              {canRemove && onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(a.id)}
                  aria-label={`Remove ${a.fileName}`}
                  className="absolute right-1 top-1 rounded-full bg-background/90 p-1 opacity-0 shadow transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="max-w-[16rem] truncate">{a.fileName}</span>
              <span className="text-muted-foreground">{formatBytes(a.fileSizeBytes)}</span>
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                  aria-label={`Download ${a.fileName}`}
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
              ) : (
                <span className="text-muted-foreground" title="Link expired — reload the page">
                  <Paperclip className="h-3.5 w-3.5" />
                </span>
              )}
              {canRemove && onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(a.id)}
                  aria-label={`Remove ${a.fileName}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {lightbox?.url && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.fileName}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="max-h-full max-w-4xl overflow-auto" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lightbox.url} alt={lightbox.fileName} className="max-h-[85vh] w-auto rounded-lg" />
            <div className="mt-2 flex items-center justify-between gap-3 text-sm text-white">
              <span className="truncate">{lightbox.fileName}</span>
              <a
                href={lightbox.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 items-center gap-1 underline"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </>
  );
}
