"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteToRecycleBin } from "@/server/recycle-bin";
import type { RecycleType } from "@/lib/recycle-types";

/**
 * Edit and Delete on a list row. Delete asks on the row itself, then moves the
 * record to the recycle bin; if a rule keeps it (an issued invoice, a won
 * deal), the reason shows under the links instead.
 */
export function RowActions({
  type,
  id,
  name,
  editHref,
  openHref,
  canDelete,
}: {
  type: RecycleType;
  id: string;
  name: string;
  editHref?: string | null;
  /** For lists whose name column does not already open the record. */
  openHref?: string | null;
  canDelete: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // A full reload after deleting: see components/log-touch-button.tsx.
  const confirm = () =>
    start(async () => {
      setError(null);
      const result = await deleteToRecycleBin(type, id);
      if (!result.ok) {
        setAsking(false);
        return setError(result.error);
      }
      window.location.reload();
    });

  const link = "text-sm font-medium text-primary hover:underline disabled:opacity-50";
  return (
    <div className="flex flex-col items-end gap-1" data-row-actions={name}>
      {asking ? (
        <span className="flex items-center gap-2 whitespace-nowrap text-sm">
          <span className="text-muted-foreground">Delete?</span>
          <button type="button" className="font-medium text-destructive hover:underline disabled:opacity-50" disabled={pending} onClick={confirm} aria-label={`Yes, delete ${name}`}>
            {pending ? "Deleting…" : "Yes"}
          </button>
          <button type="button" className={link} disabled={pending} onClick={() => setAsking(false)}>No</button>
        </span>
      ) : (
        <span className="flex items-center gap-3 whitespace-nowrap">
          {editHref && <Link href={editHref} className={link}>Edit</Link>}
          {openHref && <Link href={openHref} className={link}>Open</Link>}
          {canDelete && (
            <button type="button" className="text-sm font-medium text-destructive hover:underline" onClick={() => { setError(null); setAsking(true); }} aria-label={`Delete ${name}`}>
              Delete
            </button>
          )}
        </span>
      )}
      {error && <p className="max-w-56 text-right text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
