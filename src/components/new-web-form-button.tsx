"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";
import { createWebForm } from "@/server/web-forms";

export function NewWebFormButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New form
      </Button>
      <FormDialog open={open} onOpenChange={setOpen} title="New website form">
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Name" required help="For you, not shown on the website. For example: Contact us page.">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await createWebForm({ name, campaignId });
                  if (!result.ok) return setError(result.error);
                  router.push(`/campaigns/forms/${result.data.id}`);
                })
              }
            >
              {pending ? "Creating…" : "Create form"}
            </Button>
          </div>
        </div>
      </FormDialog>
    </>
  );
}
