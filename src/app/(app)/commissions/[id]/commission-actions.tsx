"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markPartnerCommission, setCommissionPaymentDate, changeCommissionPercent, decideCommissionRequest,
} from "@/server/partner-commissions";
import {
  Button, Card, CardHeader, CardTitle, CardContent, Field, Input, Textarea, Alert,
} from "@/components/ui";
import type { ActionResult } from "@/server/partners";

/**
 * What a person who decides commission can do with one record.
 *
 * Every action says what it will do before it does it, and each one that the
 * partner will see asks for the reason in words they will read.
 */
export function CommissionActions({
  id,
  dealWon,
  currentPercent,
  paymentDate,
  requestPending,
}: {
  id: string;
  dealWon: boolean;
  currentPercent: string;
  paymentDate: string | null;
  requestPending: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>, done: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        setNotice(done);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decide</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        <div className="space-y-2">
          <p className="font-medium">Mark as paid</p>
          <p className="text-muted-foreground">
            {dealWon
              ? "When the partner has been paid. The payment date becomes today, and the record is closed."
              : "Available once the deal is won."}
          </p>
          <Button
            size="sm"
            disabled={!dealWon || pending}
            onClick={() => {
              if (!window.confirm("Mark this commission as paid? It cannot be changed afterwards.")) return;
              run(() => markPartnerCommission({ id, status: "PAID" }), "Marked as paid.");
            }}
          >
            Mark as paid
          </Button>
        </div>

        <form
          className="space-y-2 border-t pt-4"
          action={(fd) => {
            const date = String(fd.get("paymentDate") ?? "");
            run(() => setCommissionPaymentDate({ id, paymentDate: date }), "Payment date changed.");
          }}
        >
          <Field label="Payment date" help="When the partner should be paid. Set to 90 days after the deal was won; change it if payment is agreed for another day.">
            <Input
              id="commission-payment-date"
              name="paymentDate"
              type="date"
              defaultValue={paymentDate ?? ""}
              required
            />
          </Field>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            Save payment date
          </Button>
        </form>

        <form
          className="space-y-2 border-t pt-4"
          action={(fd) => {
            const percent = String(fd.get("percent") ?? "");
            const reason = String(fd.get("reason") ?? "");
            run(
              () => changeCommissionPercent({ id, percent: Number(percent), reason }),
              "Rate changed.",
            );
          }}
        >
          <p className="font-medium">Change the rate</p>
          {requestPending ? (
            <p className="text-muted-foreground">The partner has asked for a different rate. Answer that request first.</p>
          ) : (
            <>
              <Field label="Commission %">
                <Input
                  id="commission-percent"
                  name="percent"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  defaultValue={currentPercent}
                  required
                />
              </Field>
              <Field label="Reason" help="Shown to the partner in the history.">
                <Textarea id="commission-percent-reason" name="reason" rows={2} required />
              </Field>
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                Change rate
              </Button>
            </>
          )}
        </form>

        <form
          className="space-y-2 border-t pt-4"
          action={(fd) => {
            const reason = String(fd.get("reason") ?? "");
            if (!window.confirm("Reject this commission? The partner will not be paid on this deal, and it cannot be undone.")) return;
            run(() => markPartnerCommission({ id, status: "REJECTED", reason }), "Rejected.");
          }}
        >
          <p className="font-medium">Reject</p>
          <p className="text-muted-foreground">
            When nothing will be paid on this deal. A lost deal is rejected on its own, so this is for
            other reasons.
          </p>
          <Field label="Reason" help="The partner sees this.">
            <Textarea id="commission-reject-reason" name="reason" rows={2} required />
          </Field>
          <Button type="submit" size="sm" variant="destructive" disabled={pending}>
            Reject
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Approve or decline the partner's request for a different rate. */
export function RateRequestDecision({ id, requestedPercent }: { id: string; requestedPercent: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function decide(approve: boolean) {
    setError(null);
    start(async () => {
      const result = await decideCommissionRequest({ id, approve, reason: reason || null });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Your answer" help="Needed to decline, optional to approve. The partner sees it.">
        <Textarea
          id="rate-request-reason"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide(true)} disabled={pending}>
          Approve {Number(requestedPercent)}%
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide(false)} disabled={pending || !reason.trim()}>
          Decline
        </Button>
      </div>
    </div>
  );
}
