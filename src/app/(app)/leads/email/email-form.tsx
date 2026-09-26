"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Eye, EyeOff } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle,
  Field, Input, Textarea, Table, THead, TBody, TR, TH, TD,
} from "@/components/ui";
import { sendLeadEmail } from "@/server/activities";

interface Recipient {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  /** Why this person will be left out, or null if they will be mailed. */
  skip: string | null;
}

/**
 * Writing one email to many leads.
 *
 * Two things this insists on.
 *
 * The audience is shown before the message, with anybody who will be left out
 * and why. A sender who can see that eleven of forty are unsubscribed writes a
 * different email, or goes and fixes the list first.
 *
 * There is a preview, and it renders against a real recipient rather than the
 * placeholder text. "Hello {{firstName}}" looks fine until it goes out to
 * somebody whose first name was never filled in.
 */
export function EmailLeadsForm({
  audience,
  defaultFromName,
  defaultReplyTo,
}: {
  audience: Recipient[];
  defaultFromName: string;
  defaultReplyTo: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [showAudience, setShowAudience] = useState(false);

  const sendable = audience.filter((a) => !a.skip);
  const skipped = audience.filter((a) => a.skip);

  // The preview uses the first real recipient, so the placeholders resolve to
  // somebody who actually exists.
  const sample = sendable[0];
  const fill = (text: string) =>
    text
      .replace(/\{\{\s*firstName\s*\}\}/g, sample?.name.split(" ")[0] ?? "there")
      .replace(/\{\{\s*lastName\s*\}\}/g, sample?.name.split(" ").slice(1).join(" ") ?? "")
      .replace(/\{\{\s*companyName\s*\}\}/g, sample?.companyName ?? "there");

  function submit(formData: FormData) {
    setError(null);
    const count = sendable.length;
    if (
      !window.confirm(
        `Send this to ${count} ${count === 1 ? "person" : "people"}?\n\n` +
          `This cannot be undone or recalled.`,
      )
    ) {
      return;
    }

    start(async () => {
      const result = await sendLeadEmail({
        leadIds: sendable.map((a) => a.id),
        subject: String(formData.get("subject") ?? ""),
        bodyText: String(formData.get("bodyText") ?? ""),
        fromName: String(formData.get("fromName") ?? ""),
        replyTo: String(formData.get("replyTo") ?? ""),
      });

      if (result.ok) {
        // Straight to the scorecard: the next question after sending is always
        // how it did, and the answer starts arriving within seconds.
        router.push(`/leads/email/sends/${result.data.batchId}?sent=${result.data.sent}`);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <form action={submit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>
              Going to {sendable.length} {sendable.length === 1 ? "person" : "people"}
            </CardTitle>
            {skipped.length > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                {skipped.length} of the {audience.length} selected will be left out.
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAudience(!showAudience)}
          >
            {showAudience ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showAudience ? "Hide the list" : "See who"}
          </Button>
        </CardHeader>

        {sendable.length === 0 && (
          <CardContent>
            <Alert tone="danger">
              Nobody in this selection can be emailed. Every one of them has either no address,
              or has asked not to be contacted.
            </Alert>
          </CardContent>
        )}

        {showAudience && (
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH priority="secondary">Company</TH>
                  <TH>Email</TH>
                  <TH>Will get it?</TH>
                </TR>
              </THead>
              <TBody>
                {audience.map((a) => (
                  <TR key={a.id}>
                    <TD className="text-sm font-medium">{a.name}</TD>
                    <TD className="text-sm" priority="secondary">{a.companyName ?? "—"}</TD>
                    <TD className="text-sm">{a.email ?? "—"}</TD>
                    <TD>
                      {a.skip ? (
                        <Badge tone="warning">{a.skip}</Badge>
                      ) : (
                        <Badge tone="success">Yes</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The message</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="From name" help="Shown as the sender. The address itself does not change.">
            <Input name="fromName" maxLength={120} defaultValue={defaultFromName} />
          </Field>
          <Field label="Reply to" help="Where replies land. Usually you.">
            <Input name="replyTo" type="email" maxLength={255} defaultValue={defaultReplyTo} />
          </Field>
          <Field label="Subject" required>
            <Input
              name="subject"
              required
              maxLength={300}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="A quick question about {{companyName}}"
            />
          </Field>
          <Field
            label="Placeholders"
            help="Type these and each person gets their own details. A placeholder with nothing behind it falls back to something neutral rather than going out empty."
          >
            <p className="text-sm text-muted-foreground">
              <code className="rounded bg-muted px-1">{"{{firstName}}"}</code>{" "}
              <code className="rounded bg-muted px-1">{"{{lastName}}"}</code>{" "}
              <code className="rounded bg-muted px-1">{"{{companyName}}"}</code>
            </p>
          </Field>
          <Field label="Message" required>
            <Textarea
              name="bodyText"
              required
              rows={12}
              maxLength={20000}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={"Hello {{firstName}},\n\n…"}
            />
          </Field>
          <Field
            label="Preview"
            help={sample ? `As ${sample.name} will see it.` : "Nobody to preview against."}
          >
            <div className="min-h-[13rem] rounded-md border bg-muted/30 p-3 text-sm">
              {subject || body ? (
                <>
                  <p className="font-medium">{fill(subject) || "(no subject)"}</p>
                  <p className="mt-2 whitespace-pre-wrap">{fill(body)}</p>
                  <p className="mt-4 border-t pt-2 text-xs text-muted-foreground">
                    You are receiving this because you are on our mailing list. Unsubscribe.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">Start typing to see it.</p>
              )}
            </div>
          </Field>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || sendable.length === 0}>
          <Send className="h-4 w-4" />
          {pending
            ? "Sending…"
            : `Send to ${sendable.length} ${sendable.length === 1 ? "person" : "people"}`}
        </Button>
        <p className="text-sm text-muted-foreground">
          Every message carries an unsubscribe link. Sending cannot be undone.
        </p>
      </div>
    </form>
  );
}
