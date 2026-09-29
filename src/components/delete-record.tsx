"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { deleteToRecycleBin, restoreFromRecycleBin } from "@/server/recycle-bin";
import type { RecycleType } from "@/lib/recycle-types";

/**
 * Delete, for a record's header: to the recycle bin, where it can be restored
 * for 90 days. When it cannot be deleted the button says why on hover. On a
 * record already in the bin it becomes Restore.
 */
export function DeleteRecordButton({
  type,
  id,
  name,
  deleted,
  blocker,
  listPath,
}: {
  type: RecycleType;
  id: string;
  name: string;
  deleted: boolean;
  blocker: string | null;
  listPath: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (deleted) {
    return (
      <>
        <Badge tone="danger">In the recycle bin</Badge>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await restoreFromRecycleBin(type, id);
              if (!result.ok) return window.alert(result.error);
              router.refresh();
            })
          }
        >
          <RotateCcw className="h-4 w-4" /> Restore
        </Button>
      </>
    );
  }

  return (
    <Button
      variant="outline"
      disabled={pending || Boolean(blocker)}
      title={blocker ? `Cannot be deleted: ${blocker}` : error ?? "Move to the recycle bin. It can be restored for 90 days."}
      className="text-destructive hover:text-destructive"
      onClick={() => {
        if (!window.confirm(`Delete ${name}?\n\nIt goes to the recycle bin and can be restored for 90 days.`)) return;
        start(async () => {
          setError(null);
          const result = await deleteToRecycleBin(type, id);
          if (!result.ok) {
            setError(result.error);
            return window.alert(result.error);
          }
          router.push(listPath);
          router.refresh();
        });
      }}
    >
      <Trash2 className="h-4 w-4" /> Delete
    </Button>
  );
}
