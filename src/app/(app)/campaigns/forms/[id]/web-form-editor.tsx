"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea } from "@/components/ui";
import { WEB_FORM_FIELDS } from "@/lib/marketing";
import { updateWebForm, type WebForm } from "@/server/web-forms";

export function WebFormEditor({
  form,
  users,
  canWrite,
}: {
  form: WebForm;
  users: { id: string; fullName: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(form.name);
  const [owner, setOwner] = useState(form.ownerUserId ?? "");
  const [fields, setFields] = useState(form.fields);
  const [origins, setOrigins] = useState(form.allowedOrigins.join("\n"));
  const [thankYouUrl, setThankYouUrl] = useState(form.thankYouUrl ?? "");
  const [thankYouMessage, setThankYouMessage] = useState(form.thankYouMessage);
  const [active, setActive] = useState(form.active);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const has = (key: string) => fields.find((f) => f.key === key);
  const toggle = (key: string, on: boolean) =>
    setFields((list) => {
      const next = on ? [...list, { key, required: key === "email" }] : list.filter((f) => f.key !== key);
      // Keep them in the order the form offers them.
      return WEB_FORM_FIELDS.map((f) => next.find((n) => n.key === f.key)).filter(Boolean) as typeof list;
    });
  const require = (key: string, on: boolean) => setFields((list) => list.map((f) => (f.key === key ? { ...f, required: on } : f)));

  function save() {
    start(async () => {
      setMessage(null);
      const result = await updateWebForm(form.id, {
        name,
        ownerUserId: owner || null,
        fields,
        allowedOrigins: origins.split(/[\s,]+/).map((o) => o.trim()).filter(Boolean),
        thankYouUrl,
        thankYouMessage,
        active,
      });
      setMessage(result.ok ? { tone: "success", text: "Saved. Update the code on your website if you changed the fields." } : { tone: "danger", text: result.error });
      if (result.ok) router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} maxLength={200} />
        </Field>
        <Field label="Prospects go to" help="Who owns the prospects it makes. The campaign's owner if nobody is chosen.">
          <Select value={owner} onChange={(e) => setOwner(e.target.value)} disabled={!canWrite}>
            <option value="">The campaign&apos;s owner</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </Select>
        </Field>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-sm font-medium">What it asks for</legend>
          {WEB_FORM_FIELDS.map((f) => (
            <div key={f.key} className="flex items-center justify-between gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4" checked={Boolean(has(f.key))} disabled={!canWrite} onChange={(e) => toggle(f.key, e.target.checked)} />
                {f.label}
              </label>
              {has(f.key) && (
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" className="h-3.5 w-3.5" checked={Boolean(has(f.key)?.required)} disabled={!canWrite} onChange={(e) => require(f.key, e.target.checked)} />
                  Required
                </label>
              )}
            </div>
          ))}
        </fieldset>
        <Field label="Websites allowed to use it" help="One per line, such as https://babultech.com. Leave empty to allow any.">
          <Textarea rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} disabled={!canWrite} />
        </Field>
        <Field label="Thank-you message" help="Shown on the page after someone sends the form.">
          <Input value={thankYouMessage} onChange={(e) => setThankYouMessage(e.target.value)} disabled={!canWrite} maxLength={500} />
        </Field>
        <Field label="Or send them to this page instead" help="Optional: a full web address on your site.">
          <Input value={thankYouUrl} onChange={(e) => setThankYouUrl(e.target.value)} disabled={!canWrite} placeholder="https://babultech.com/thank-you" />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={active} disabled={!canWrite} onChange={(e) => setActive(e.target.checked)} />
          Live - accepting submissions
        </label>
        {canWrite && (
          <Button type="button" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save form"}</Button>
        )}
      </CardContent>
    </Card>
  );
}
