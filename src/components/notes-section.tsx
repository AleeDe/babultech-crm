import { listNotes, listMentionableUsers } from "@/server/notes";
import { NotesPanel } from "@/components/notes-panel";

/**
 * Notes on a record, with everything they need fetched here.
 *
 * A server component wrapper so the thirteen detail pages that show notes do
 * not each have to remember to load the mention list alongside them. One of
 * them forgetting would mean @ silently does nothing on that screen — a bug
 * nobody notices until someone tries to mention a colleague on an invoice.
 *
 * Pages that already fetch their notes for other reasons can keep passing them
 * in; `notes` is optional and only fetched here when it is absent.
 */
export async function NotesSection({
  entityType,
  entityId,
  notes,
}: {
  entityType: string;
  entityId: string;
  notes?: Awaited<ReturnType<typeof listNotes>>;
}) {
  const [loadedNotes, users] = await Promise.all([
    notes ? Promise.resolve(notes) : listNotes(entityType, entityId),
    listMentionableUsers(),
  ]);

  return (
    <NotesPanel
      entityType={entityType}
      entityId={entityId}
      notes={loadedNotes}
      users={users}
    />
  );
}
