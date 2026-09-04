"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordFirstResponse } from "@/server/cases";
import { Button, Card, CardContent, CardHeader, CardTitle, Alert } from "@/components/ui";

export function FirstResponseControl({
  caseId,
  alreadyResponded,
  dueAt,
}: {
  caseId: string;
  alreadyResponded: boolean;
  dueAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (alreadyResponded) return null;

  const late = dueAt ? new Date(dueAt) < new Date() : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>First response</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-sm text-muted-foreground">
          Not yet recorded. This is the clock SLA attainment is measured against
          {late ? ", and it is already past due." : "."}
        </p>
        <Button
          className="w-full"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await recordFirstResponse(caseId);
              if (result.ok) router.refresh();
              else setError(result.error);
            })
          }
        >
          {pending ? "Recording…" : "Mark first response sent"}
        </Button>
      </CardContent>
    </Card>
  );
}
