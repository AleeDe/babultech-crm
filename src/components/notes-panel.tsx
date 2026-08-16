"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StickyNote, Trash2, Pencil, Check, X, Lock, Users, Globe } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardContent, Textarea, Select, Button, Alert, Badge,
} from "@/components/ui";
import { createNote, updateNote, deleteNote, type Note } from "@/server/notes";
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
}: {
  entityType: string;
  entityId: string;
  notes: Note[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

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

  function add(formData: FormData) {
    run(
      () =>
        createNote({
          relatedEntityType: entityType as never,
          relatedEntityId: entityId,
          content: String(formData.get("content") ?? ""),
          visibility: String(formData.get("visibility") ?? "TEAM") as never,
          title: null,
        }),
      () => setAdding(false),
    );
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
          <form action={add} className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <Textarea
              name="content"
              rows={3}
              required
              autoFocus
              placeholder="What happened, what was agreed, what to do next…"
            />
            <div className="flex items-center justify-between gap-2">
              <Select name="visibility" defaultValue="TEAM" className="w-40 text-xs">
                <option value="PRIVATE">Only me</option>
                <option value="TEAM">My team</option>
                <option value="ORGANIZATION">Everyone</option>
              </Select>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Save note"}
              </Button>
            </div>
          </form>
        )}

        {notes.length === 0 && !adding ? (
          <p className="py-2 text-sm text-muted-foreground">
            No notes yet. Notes are where the reasoning lives — why a discount was given, what the
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
                    <form
                      action={(formData) =>
                        run(
                          () =>
                            updateNote(
                              note.id,
                              String(formData.get("content") ?? ""),
                              String(formData.get("visibility") ?? note.visibility),
                            ),
                          () => setEditing(null),
                        )
                      }
                      className="space-y-2"
                    >
                      <Textarea name="content" rows={3} defaultValue={note.content} required autoFocus />
                      <div className="flex items-center justify-between gap-2">
                        <Select name="visibility" defaultValue={note.visibility} className="w-40 text-xs">
                          <option value="PRIVATE">Only me</option>
                          <option value="TEAM">My team</option>
                          <option value="ORGANIZATION">Everyone</option>
                        </Select>
                        <div className="flex gap-1">
                          <Button type="submit" size="sm" disabled={pending}>
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="whitespace-pre-line text-sm leading-relaxed">{note.content}</p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {note.createdBy?.fullName ?? "Unknown"}
                        </span>
                        <span>{formatDateTime(note.createdAt)}</span>
                        <Badge tone={vis.tone}>
                          <VisIcon className="h-3 w-3" /> {vis.label}
                        </Badge>

                        {note.isMine && (
                          <span className="ml-auto flex gap-1">
                            <button
                              onClick={() => setEditing(note.id)}
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
