"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Textarea } from "@/components/ui";
import { sendPartnerLeadEmail } from "@/server/partner-leads";
import type { SendResult } from "@/lib/lead-mailer";

/** One message to the chosen leads, each addressed by name. */
export function PartnerEmailForm({
  leads,
  senderName,
  replyTo,
}: {
  leads: { id: string; name: string; email: string | null }[];
  senderName: string;
  replyTo: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SendResult | null>(null);

  const withAddress = leads.filter((l) => l.email);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    start(async () => {
      const result = await sendPartnerLeadEmail({
        leadIds: withAddress.map((l) => l.id),
        subject: String(form.get("subject") ?? ""),
        bodyText: String(form.get("bodyText") ?? ""),
      });
      if (result.ok) setSent(result.data);
      else setError(result.error);
    });
  }

  if (sent) {
    return (
      <Alert tone={sent.failed ? "warning" : "success"}>
        <p className="font-medium">
          Sent to {sent.sent} {sent.sent === 1 ? "person" : "people"}
          {sent.failed ? `; ${sent.failed} could not be sent` : ""}.
        </p>
        {sent.skippedReasons.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {sent.skippedReasons.map((r) => <li key={r}>Left out - {r}</li>)}
          </ul>
        )}
        <p className="mt-2 text-sm">Each email shows on its lead, with whether it was opened.</p>
        <div className="mt-3">
          <Button asChild size="sm" variant="outline"><a href="/portal/leads">Back to your leads</a></Button>
        </div>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>
            Going to {withAddress.length} {withAddress.length === 1 ? "person" : "people"}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            From <span className="font-medium text-foreground">{senderName} via BabulTech</span>
            {replyTo ? <>; replies go to <span className="font-medium text-foreground">{replyTo}</span></> : null}.
          </p>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-2 text-sm">
            {leads.map((l) => (
              <li key={l.id} className={`rounded-full border px-3 py-1 ${l.email ? "" : "text-muted-foreground line-through"}`}>
                {l.name}{l.email ? "" : " (no email)"}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Message</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Subject" required>
            <Input name="subject" required maxLength={300} />
          </Field>
          <Field
            label="Message"
            required
            hint="{{firstName}}, {{lastName}} and {{companyName}} are filled in for each person. An unsubscribe link is added at the bottom."
          >
            <Textarea name="bodyText" rows={10} required maxLength={20000} defaultValue={"Hello {{firstName}},\n\n"} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || withAddress.length === 0}>
          <Send className="h-4 w-4" /> {pending ? "Sending…" : "Send"}
        </Button>
      </div>
    </form>
  );
}
