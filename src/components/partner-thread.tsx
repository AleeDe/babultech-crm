"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AtSign, FileText, ImageIcon, Mail, MessageSquare, Paperclip, Send, X,
} from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Textarea, EmptyState,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import {
  postPartnerMessage, sendPartnerEmail, attachToPartnerMessage,
  markPartnerThreadRead, type PartnerMessage,
} from "@/server/partner-activities";

/**
 * The conversation with a partner, used by both sides.
 *
 * `side` says who is reading, which decides only which messages sit on the
 * right and what the other party is called. Everything else is identical —
 * deliberately, because two divergent implementations of one thread is how the
 * two sides end up seeing different conversations.
 */
export function PartnerThread({
  partnerId,
  messages,
  side,
  otherPartyName,
  defaultEmailTo,
}: {
  partnerId: string;
  messages: PartnerMessage[];
  side: "PARTNER" | "INTERNAL";
  otherPartyName: string;
  defaultEmailTo: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"MESSAGE" | "EMAIL">("MESSAGE");
  const [body, setBody] = useState("");
  const [subject, setSubject] = useState("");
  const [to, setTo] = useState(defaultEmailTo);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const endOfThread = useRef<HTMLDivElement>(null);

  // Opening the thread is what marks the other side's messages as seen. Doing
  // it on mount rather than on reply: a message read and not answered has still
  // been read, and leaving it unread would keep nagging the other side.
  useEffect(() => {
    markPartnerThreadRead(partnerId).catch(() => {});
  }, [partnerId]);

  useEffect(() => {
    endOfThread.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 5));
    if (fileInput.current) fileInput.current.value = "";
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    start(async () => {
      const result =
        mode === "EMAIL"
          ? await sendPartnerEmail({ partnerId, to, subject, body })
          : await postPartnerMessage({ partnerId, body });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Files are attached after the message exists, because an attachment
      // needs something to hang on. A failure here leaves the message sent and
      // says which file did not make it, rather than discarding everything.
      const failed: string[] = [];
      for (const file of files) {
        const fd = new FormData();
        fd.set("messageId", result.data.id);
        fd.set("file", file);
        const attached = await attachToPartnerMessage(fd);
        if (!attached.ok) failed.push(`${file.name}: ${attached.error}`);
      }

      setBody("");
      setSubject("");
      setFiles([]);

      if (failed.length) {
        setError(`Sent, but some files did not attach — ${failed.join("; ")}`);
      } else if (mode === "EMAIL") {
        const sent = (result.data as { sent?: boolean; error?: string | null }).sent;
        const why = (result.data as { error?: string | null }).error;
        setNotice(
          sent
            ? `Email sent to ${to}.`
            : `Saved to the conversation, but the email did not go out (${why ?? "unknown reason"}).`,
        );
      }

      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" /> Activities
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          {side === "PARTNER"
            ? "Talk to us here. Messages, email and files all stay on this thread, so nothing depends on who happens to be reading their inbox."
            : `Your conversation with ${otherPartyName}. They see this thread in their portal.`}
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {messages.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            description={
              side === "PARTNER"
                ? "Send us a message and it will appear here, along with anything we send back."
                : "Nothing has been said yet. Anything you write here appears in the partner's portal."
            }
          />
        ) : (
          <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {messages.map((message) => {
              const mine = message.authorSide === side;
              return (
                <div key={message.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={`max-w-[85%] rounded-lg border p-3 text-sm ${
                      mine ? "bg-primary/5" : "bg-card"
                    }`}
                  >
                    <p className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{message.authorName}</span>
                      {message.kind === "EMAIL" && (
                        <Badge tone="neutral">
                          <Mail className="mr-1 inline h-3 w-3" />
                          Email
                        </Badge>
                      )}
                      <span>{formatDateTime(message.createdAt)}</span>
                    </p>

                    {message.kind === "EMAIL" && (
                      <p className="mb-2 border-b pb-2 text-xs">
                        <span className="font-medium">{message.subject}</span>
                        {message.toAddresses?.length ? (
                          <span className="block text-muted-foreground">
                            <AtSign className="mr-0.5 inline h-3 w-3" />
                            {message.toAddresses.join(", ")}
                          </span>
                        ) : null}
                      </p>
                    )}

                    <p className="whitespace-pre-line">{message.body}</p>

                    {message.attachments.length > 0 && (
                      <ul className="mt-2 space-y-1.5 border-t pt-2">
                        {message.attachments.map((file) => (
                          <li key={file.id} className="text-xs">
                            {file.isImage && file.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={file.url}
                                alt={file.fileName}
                                className="max-h-48 rounded border"
                              />
                            ) : file.url ? (
                              <a
                                href={file.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 underline"
                              >
                                <FileText className="h-3 w-3" />
                                {file.fileName}
                              </a>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <FileText className="h-3 w-3" />
                                {file.fileName} (unavailable)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endOfThread} />
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3 border-t pt-4">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "MESSAGE" ? "default" : "outline"}
              onClick={() => setMode("MESSAGE")}
            >
              <MessageSquare className="h-4 w-4" /> Message
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "EMAIL" ? "default" : "outline"}
              onClick={() => setMode("EMAIL")}
            >
              <Mail className="h-4 w-4" /> Email
            </Button>
          </div>

          {mode === "EMAIL" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="To" required help="Change it if this should go to somebody else.">
                <Input
                  id="thread-to"
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  required
                />
              </Field>
              <Field label="Subject" required>
                <Input
                  id="thread-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  required
                  maxLength={300}
                />
              </Field>
            </div>
          )}

          <Field label={mode === "EMAIL" ? "Your email" : "Your message"} required>
            <Textarea
              id="thread-body"
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={10000}
              placeholder={
                mode === "EMAIL"
                  ? "Write the email…"
                  : side === "PARTNER"
                    ? "Ask us something, or tell us what is happening…"
                    : "Reply to the partner…"
              }
            />
          </Field>

          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
                >
                  {file.type.startsWith("image/") ? (
                    <ImageIcon className="h-3 w-3" />
                  ) : (
                    <FileText className="h-3 w-3" />
                  )}
                  {file.name}
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove ${file.name}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending || !body.trim()}>
              <Send className="h-4 w-4" />
              {pending ? "Sending…" : mode === "EMAIL" ? "Send email" : "Send message"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending || files.length >= 5}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip className="h-4 w-4" /> Attach a file
            </Button>
            <input
              id="thread-files"
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => addFiles(e.target.files)}
            />
            <span className="text-xs text-muted-foreground">
              Up to 5 files, 10MB each. Images, PDFs, Office files and text.
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
