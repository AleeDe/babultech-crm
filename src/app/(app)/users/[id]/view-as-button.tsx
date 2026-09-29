"use client";

import { useState, useTransition } from "react";
import { Eye } from "lucide-react";
import { Alert, Button, Field, Textarea } from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";
import { startViewAs } from "@/server/view-as";

/**
 * Starts a read-only View as session for this user. The reason is kept in the
 * security history beside the start and end of the session.
 */
export function ViewAsButton({ userId, name, refusal }: { userId: string; name: string; refusal: string | null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (refusal) {
    return (
      <Button variant="outline" disabled title={refusal}>
        <Eye className="h-4 w-4" /> View as
      </Button>
    );
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Eye className="h-4 w-4" /> View as
      </Button>
      <FormDialog open={open} onOpenChange={setOpen} title={`View as ${name}`}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            You will see the CRM exactly as {name} does, with their permissions and records. It is read-only, ends
            after 30 minutes, and the start, end and your reason are kept in the security history.
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Reason" required help="For example: they cannot see the Acme deal.">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await startViewAs({ targetUserId: userId, reason });
                  if (result && !result.ok) setError(result.error);
                })
              }
            >
              {pending ? "Starting…" : "Start View as"}
            </Button>
          </div>
        </div>
      </FormDialog>
    </>
  );
}
