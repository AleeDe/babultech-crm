"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";
import { syncProjectFromDeal } from "@/server/projects";

/**
 * Pull in services added to the deal after it was won.
 *
 * Safe to press at any time: it only adds tasks for lines that have none, and
 * never touches a task a project manager has already reworked.
 */
export function SyncFromDeal({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run() {
    setMessage(null);
    start(async () => {
      const result = await syncProjectFromDeal(projectId);
      if (!result.ok) return setMessage(result.error);
      setMessage(
        result.data.added === 0
          ? "Already up to date with the deal."
          : `Added ${result.data.added} task(s) from the deal.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={run} disabled={pending}>
        <RefreshCw className={pending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        Sync from deal
      </Button>
      {message && <span className="text-sm text-muted-foreground">{message}</span>}
    </div>
  );
}
