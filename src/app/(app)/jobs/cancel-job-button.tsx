"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { cancelJob } from "@/server/jobs";

export function CancelJobButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!window.confirm("Stop this job? Whatever it has already done stays done.")) return;
        start(async () => {
          const result = await cancelJob(id);
          if (!result.ok) window.alert(result.error);
          router.refresh();
        });
      }}
    >
      Stop
    </Button>
  );
}
