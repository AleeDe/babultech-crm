"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Select, Input, Button, Alert } from "@/components/ui";
import { updateMyTaskProgress } from "@/server/my-work";

/**
 * Inline status and percentage editor for a task on the My Work list.
 *
 * Deliberately narrow: an assignee moves their own task along, but reassigning
 * it or changing its scope belongs on the project screen where the manager
 * works. The server enforces that too — this is only the affordance.
 */
export function TaskProgress({
  taskId,
  status,
  completionPercent,
}: {
  taskId: string;
  status: string;
  completionPercent: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  function save(formData: FormData) {
    setError(null);
    start(async () => {
      const result = await updateMyTaskProgress(taskId, {
        status: String(formData.get("status") ?? "") as never,
        completionPercent: Number(formData.get("completionPercent") ?? 0),
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)} className="h-7 px-2 text-xs">
        Update
      </Button>
    );
  }

  return (
    <form action={save} className="flex flex-wrap items-center gap-2">
      <Select name="status" defaultValue={status} className="h-8 w-40 text-xs">
        <option value="NOT_STARTED">Not started</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="BLOCKED">Blocked</option>
        <option value="UNDER_REVIEW">Under review</option>
        <option value="COMPLETED">Completed</option>
      </Select>
      <Input
        name="completionPercent"
        type="number"
        min="0"
        max="100"
        defaultValue={completionPercent}
        className="h-8 w-20 text-xs"
        aria-label="Percent complete"
      />
      <Button type="submit" disabled={pending} className="h-8 px-2">
        <Check className="h-3.5 w-3.5" />
      </Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)} className="h-8 px-2 text-xs">
        Cancel
      </Button>
      {error && (
        <div className="w-full">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
    </form>
  );
}
