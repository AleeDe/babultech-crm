"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MinusCircle, PlusCircle, Scale } from "lucide-react";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Textarea,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils";
import { adjustCommission } from "@/server/commissions";

/**
 * Add to or take away from what a partner earned on this deal.
 *
 * Deliberately not an edit of the commission itself. The calculated figure is
 * evidence of what the plan produced, and a screen that overwrites it loses the
 * only record of that. An adjustment is a second, signed line with a reason
 * attached, so the ledger still adds up and the decision stays visible.
 *
 * The direction is chosen before the amount rather than by typing a minus sign:
 * a stray sign on a payout figure is an expensive typo, and "Take away" said
 * out loud is much harder to do by accident.
 */
export function AdjustPanel({
  partnerId,
  opportunityId,
  recordId,
  currencyCode,
  partnerName,
}: {
  partnerId: string;
  opportunityId: string;
  recordId: string;
  currencyCode: string;
  partnerName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"ADD" | "REMOVE">("ADD");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const magnitude = Number(amount);
  const valid = Number.isFinite(magnitude) && magnitude > 0 && reason.trim().length >= 3;

  function reset() {
    setOpen(false);
    setAmount("");
    setReason("");
    setDirection("ADD");
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    start(async () => {
      const result = await adjustCommission({
        partnerId,
        opportunityId,
        adjustsRecordId: recordId,
        amount: direction === "ADD" ? magnitude : -magnitude,
        currencyCode,
        reason,
      });

      if (result.ok) {
        reset();
        setNotice(
          `${result.data.commissionNumber} recorded. ${partnerName} will ${
            direction === "ADD" ? "earn" : "lose"
          } ${formatMoney(magnitude, currencyCode)} on this deal.`,
        );
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-4 w-4" /> Adjust this commission
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            When what was agreed differs from what the plan calculated. The original figure is
            kept; the adjustment is recorded beside it with your reason.
          </p>
        </div>
        {!open && (
          <Button variant="secondary" onClick={() => { setOpen(true); setNotice(null); }}>
            Adjust
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {open && (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={direction === "ADD" ? "default" : "outline"}
                onClick={() => setDirection("ADD")}
              >
                <PlusCircle className="h-4 w-4" /> Add commission
              </Button>
              <Button
                type="button"
                variant={direction === "REMOVE" ? "default" : "outline"}
                onClick={() => setDirection("REMOVE")}
              >
                <MinusCircle className="h-4 w-4" /> Take commission away
              </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={`Amount (${currencyCode})`}
                required
                help="How much to add or take away. Always a positive number — the buttons above decide the direction."
              >
                <Input
                  id="adjust-amount"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  required
                  placeholder="5000"
                />
              </Field>
            </div>

            <Field
              label="Why"
              required
              help="This is kept permanently and is what a later reviewer will read. Say what was agreed and with whom."
            >
              <Textarea
                id="adjust-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={3}
                placeholder="Agreed with Hassan on 18 Sep: goodwill top-up for the extra scoping work on this deal."
              />
            </Field>

            {valid && (
              <Alert tone={direction === "ADD" ? "info" : "warning"}>
                {partnerName} will {direction === "ADD" ? "earn a further" : "lose"}{" "}
                <strong>{formatMoney(magnitude, currencyCode)}</strong> on this deal.
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={pending || !valid}>
                {pending ? "Recording…" : "Record adjustment"}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
