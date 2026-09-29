"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Card, Field, Input, Table, TBody, TD, TH, THead, TR } from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";
import { saveSender, deleteSender, type EmailSender } from "@/server/communications";

type Draft = { id: string | null; label: string; fromName: string; fromAddress: string; replyTo: string; isDefault: boolean; active: boolean };

export function SendersEditor({ senders, domain }: { senders: EmailSender[]; domain: string | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      if (!draft) return;
      setError(null);
      const result = await saveSender(draft);
      if (!result.ok) return setError(result.error);
      setDraft(null);
      router.refresh();
    });

  return (
    <>
      {domain && (
        <div className="mb-4">
          <Button onClick={() => { setError(null); setDraft({ id: null, label: "", fromName: "", fromAddress: `@${domain}`, replyTo: "", isDefault: false, active: true }); }}>
            Add a sender
          </Button>
        </div>
      )}
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Sender</TH>
              <TH>Address</TH>
              <TH priority="secondary">Replies to</TH>
              <TH />
            </TR>
          </THead>
          <TBody>
            {senders.map((s) => (
              <TR key={s.id}>
                <TD className="text-sm">
                  <span className="font-medium">{s.label}</span>{" "}
                  {s.isDefault && <Badge tone="info">Default</Badge>} {!s.active && <Badge tone="neutral">Off</Badge>}
                  <p className="text-xs text-muted-foreground">Shows as {s.fromName}</p>
                </TD>
                <TD className="text-sm">{s.fromAddress}</TD>
                <TD className="text-sm" priority="secondary">{s.replyTo ?? "The same address"}</TD>
                <TD className="text-right">
                  <span className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setError(null); setDraft({ ...s, replyTo: s.replyTo ?? "" }); }}>Edit</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        if (!window.confirm(`Remove ${s.fromAddress} as a sender?`)) return;
                        start(async () => {
                          const result = await deleteSender(s.id);
                          if (!result.ok) window.alert(result.error);
                          router.refresh();
                        });
                      }}
                    >
                      Remove
                    </Button>
                  </span>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      <FormDialog open={Boolean(draft)} onOpenChange={(v) => !v && setDraft(null)} title={draft?.id ? "Edit sender" : "Add a sender"}>
        {draft && (
          <div className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Label" required help="What people pick, such as Sales.">
                <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} maxLength={80} />
              </Field>
              <Field label="Shows as" required help="The name in the recipient's inbox.">
                <Input value={draft.fromName} onChange={(e) => setDraft({ ...draft, fromName: e.target.value })} maxLength={120} />
              </Field>
              <Field label="Address" required>
                <Input type="email" value={draft.fromAddress} onChange={(e) => setDraft({ ...draft, fromAddress: e.target.value })} maxLength={255} />
              </Field>
              <Field label="Replies to" help="Optional: a mailbox someone reads.">
                <Input type="email" value={draft.replyTo} onChange={(e) => setDraft({ ...draft, replyTo: e.target.value })} maxLength={255} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
              Chosen first when composing
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
              Offered when composing
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
              <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save sender"}</Button>
            </div>
          </div>
        )}
      </FormDialog>
    </>
  );
}
