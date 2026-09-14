"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StickyNote, Trash2, Pencil, Check, X, Lock, Users, Globe, Paperclip } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardContent, Textarea, Select, Button, Alert, Badge,
} from "@/components/ui";
import {
  createNote, updateNote, deleteNote, attachToNote, removeNoteAttachment, type Note,
} from "@/server/notes";
import { NoteComposer, type MentionableUser } from "@/components/note-composer";
import { NoteBody, NoteAttachments } from "@/components/note-body";
import { formatDateTime } from "@/lib/utils";

const VISIBILITY = {
  PRIVATE: { label: "Only me", icon: Lock, tone: "warning" as const },
  TEAM: { label: "My team", icon: Users, tone: "neutral" as const },
  ORGANIZATION: { label: "Everyone", icon: Globe, tone: "info" as const },
};

/**
 * Notes on a record.
 *
 * Kept as one component used from every detail page, so a note reads and
 * behaves the same whether it is on an account or a project. Ownership rules
 * are enforced on the server; this only shows or hides the controls.
 */
export function NotesPanel({
  entityType,
  entityId,
  notes,
  users = [],
}: {
  entityType: string;
  entityId: string;
  notes: Note[];
  /** Colleagues who can be @mentioned. Empty disables the picker. */
  users?: MentionableUser[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // The composer is controlled so the @ picker can rewrite the text around the
  // caret; an uncontrolled textarea could not.
  const [draft, setDraft] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [editVisibility, setEditVisibility] = useState("TEAM");
  const [visibility, setVisibility] = useState("TEAM");

  // Files chosen before the note exists. A note has to be saved before anything
  // can hang off it, so they are held here and uploaded immediately after.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setError(result.error ?? "That did not work.");
      }
    });
  }

  function add() {
    if (!draft.trim() && pendingFiles.length === 0) return;

    setError(null);
    start(async () => {
      const result = await createNote({
        relatedEntityType: entityType as never,
        relatedEntityId: entityId,
        // A note that is only a screenshot still needs something in it, and
        // saying so beats refusing the save with a validation error.
        content: draft.trim() || "(attachment)",
        visibility: visibility as never,
        title: null,
      });

      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }

      // Uploaded one at a time after the note exists. A failure here leaves the
      // note saved and says which file did not make it, rather than losing what
      // the person wrote.
      if (pendingFiles.length && result.data?.id) {
        setUploading(true);
        for (const file of pendingFiles) {
          const fd = new FormData();
          fd.set("noteId", result.data.id);
          fd.set("file", file);
          const up = await attachToNote(fd);
          if (!up.ok) setError(`${file.name}: ${up.error}`);
        }
        setUploading(false);
      }

      setDraft("");
      setPendingFiles([]);
      setVisibility("TEAM");
      setAdding(false);
      router.refresh();
    });
  }

  /** Attaching to a note that already exists. */
  function attachNow(noteId: string, files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    start(async () => {
      setUploading(true);
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.set("noteId", noteId);
        fd.set("file", file);
        const up = await attachToNote(fd);
        if (!up.ok) setError(`${file.name}: ${up.error}`);
      }
      setUploading(false);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-muted-foreground" />
          Notes
          {notes.length > 0 && (
            <span className="text-xs font-normal text-muted-foreground">({notes.length})</span>
          )}
        </CardTitle>
        <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>
          {adding ? "Cancel" : "Add note"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {adding && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <NoteComposer
              value={draft}
              onChange={setDraft}
              users={users}
              rows={3}
              autoFocus
              placeholder="What happened, what was agreed, what to do next…"
            />

            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {pendingFiles.map((f, i) => (
                  <span
                    key={`${f.name}-${i}`}
                    className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs"
                  >
                    <Paperclip className="h-3 w-3 text-muted-foreground" aria-hidden />
                    <span className="max-w-[12rem] truncate">{f.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setPendingFiles((fs) => fs.filter((_, x) => x !== i))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value)}
                  className="w-36 text-xs"
                  aria-label="Who can see this note"
                >
                  <option value="PRIVATE">Only me</option>
                  <option value="TEAM">My team</option>
                  <option value="ORGANIZATION">Everyone</option>
                </Select>

                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs hover:bg-accent">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  Attach
                  <input
                    type="file"
                    multiple
                    className="sr-only"
                    aria-label="Attach files to this note"
                    onChange={(e) => {
                      setPendingFiles((fs) => [...fs, ...Array.from(e.target.files ?? [])]);
                      // Cleared so choosing the same file twice still fires.
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <Button type="button" size="sm" onClick={add} disabled={pending || uploading}>
                {uploading ? "Uploading…" : pending ? "Saving…" : "Save note"}
              </Button>
            </div>
          </div>
        )}

        {notes.length === 0 && !adding ? (
          <p className="py-2 text-sm text-muted-foreground">
            No notes yet. Notes are where the reasoning lives - why a discount was given, what the
            customer actually said.
          </p>
        ) : (
          <ul className="space-y-3">
            {notes.map((note) => {
              const vis = VISIBILITY[note.visibility as keyof typeof VISIBILITY] ?? VISIBILITY.TEAM;
              const VisIcon = vis.icon;

              return (
                <li key={note.id} className="rounded-lg border p-3">
                  {editing === note.id ? (
                    <div className="space-y-2">
                      <NoteComposer
                        value={editDraft}
                        onChange={setEditDraft}
                        users={users}
                        rows={3}
                        autoFocus
                      />
                      <div className="flex items-center justify-between gap-2">
                        <Select
                          value={editVisibility}
                          onChange={(e) => setEditVisibility(e.target.value)}
                          className="w-36 text-xs"
                          aria-label="Who can see this note"
                        >
                          <option value="PRIVATE">Only me</option>
                          <option value="TEAM">My team</option>
                          <option value="ORGANIZATION">Everyone</option>
                        </Select>
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            disabled={pending}
                            aria-label="Save note"
                            onClick={() =>
                              run(
                                () => updateNote(note.id, editDraft, editVisibility),
                                () => setEditing(null),
                              )
                            }
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label="Cancel"
                            onClick={() => setEditing(null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <NoteBody content={note.content} />

                      <NoteAttachments
                        attachments={note.attachments ?? []}
                        canRemove={note.isMine}
                        onRemove={(id) => run(() => removeNoteAttachment(id))}
                      />

                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {note.createdBy?.fullName ?? "Unknown"}
                        </span>
                        <span>{formatDateTime(note.createdAt)}</span>
                        <Badge tone={vis.tone}>
                          <VisIcon className="h-3 w-3" /> {vis.label}
                        </Badge>

                        {note.isMine && (
                          <span className="ml-auto flex items-center gap-1">
                            <label
                              className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                              title="Attach a file"
                            >
                              <Paperclip className="h-3.5 w-3.5" />
                              <input
                                type="file"
                                multiple
                                className="sr-only"
                                aria-label={`Attach a file to this note`}
                                onChange={(e) => {
                                  attachNow(note.id, e.target.files);
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            <button
                              onClick={() => {
                                setEditDraft(note.content);
                                setEditVisibility(note.visibility);
                                setEditing(note.id);
                              }}
                              aria-label="Edit note"
                              className="text-muted-foreground transition-colors hover:text-foreground"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => run(() => deleteNote(note.id))}
                              disabled={pending}
                              aria-label="Remove note"
                              className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        )}
                      </div>
                    </>
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
