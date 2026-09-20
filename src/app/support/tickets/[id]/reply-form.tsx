"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Textarea } from "@/components/ui";
import { replyToTicket } from "@/server/support-portal";

/** The customer's side of the conversation on their own ticket. */
export function ReplyForm({ caseId }: { caseId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) return;
    setError(null);
    start(async () => {
      const result = await replyToTicket({ caseId, body });
      if (result.ok) {
        setBody("");
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        placeholder="Add anything else that might help, or answer a question from our team."
        aria-label="Your reply"
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !body.trim()}>
          {pending ? "Sending…" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
