"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendQuotation, decideQuotation, reviseQuotation } from "@/server/quotations";
import { Button, Card, CardContent, CardHeader, CardTitle, Alert } from "@/components/ui";

const EDITABLE = ["DRAFT", "UNDER_REVIEW", "APPROVED"];

/**
 * The quote's lifecycle in one panel. Each transition is a distinct server
 * action because each has different consequences — sending moves the deal to
 * Quote Submitted, accepting is what unlocks Closed Won.
 */
export function QuoteActions({
  quoteId,
  status,
  expiryDate,
}: {
  quoteId: string;
  status: string;
  expiryDate: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        if (success) setNotice(success);
        router.refresh();
      } else setError(result.error ?? "Something went wrong.");
    });
  };

  const expired = new Date(expiryDate) < new Date();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where this quote is</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {EDITABLE.includes(status) && (
          <>
            <p className="text-sm text-muted-foreground">
              Still a draft — nothing has gone to the customer. Sending it freezes the numbers.
            </p>
            <Button
              className="w-full"
              disabled={pending || expired}
              onClick={() => run(() => sendQuotation(quoteId), "Sent. The deal has moved to Quote Submitted.")}
            >
              {pending ? "Working…" : "Mark as sent"}
            </Button>
            {expired && (
              <p className="text-xs text-destructive">
                The expiry date has passed — extend it before sending.
              </p>
            )}
          </>
        )}

        {status === "SENT" && (
          <>
            <p className="text-sm text-muted-foreground">
              With the customer. Accepting sets the deal amount to the quote total and moves it to
              Verbal Confirmation — and it is what lets the deal be marked Closed Won.
            </p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={pending}
                onClick={() => run(() => decideQuotation(quoteId, "ACCEPTED"), "Accepted.")}
              >
                Accepted
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                disabled={pending}
                onClick={() => run(() => decideQuotation(quoteId, "REJECTED"), "Marked as rejected.")}
              >
                Rejected
              </Button>
            </div>
          </>
        )}

        {status === "ACCEPTED" && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            Accepted — this is the binding version and the deal can now be won.
          </p>
        )}

        {status !== "ACCEPTED" && (
          <Button
            variant="outline"
            className="w-full"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await reviseQuotation(quoteId);
                if (result.ok) router.push(`/quotations/${result.data.id}`);
                else setError(result.error);
              })
            }
          >
            Create a revision
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
