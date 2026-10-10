"use client";

import Link from "next/link";
import type { RecycleType } from "@/lib/recycle-types";
import { DeleteConfirm } from "./delete-confirm";

/**
 * Edit, Open and Delete on a list row. Delete is the Super Admin's: it opens
 * a short confirmation on the row (what goes with it, and why), then moves the
 * record to the recycle bin.
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
  const link = "text-sm font-medium text-primary hover:underline";
  return (
    <div className="flex flex-col items-end gap-1" data-row-actions={name}>
      <span className="flex items-start gap-3 whitespace-nowrap">
        {editHref && <Link href={editHref} className={link}>Edit</Link>}
        {openHref && <Link href={openHref} className={link}>Open</Link>}
        {canDelete && <DeleteConfirm type={type} id={id} name={name} />}
      </span>
    </div>
  );
}
