"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock, Percent, X } from "lucide-react";
import {
  Alert, Badge, Button, Field, Input, Textarea,
} from "@/components/ui";
import { formatDate } from "@/lib/utils";
import {
  proposeCommission, withdrawProposal, type CommissionProposal,
} from "@/server/commission-proposals";

/**
 * Asking for a different rate on one deal.
 *
 * Shown inline on the deal rather than as a separate screen, because the case a
 * partner makes is always about a particular deal and writing it anywhere else
 * loses that. Nothing here changes what they are paid: it is a request, and it
 * says so.
 */
export function RateRequest({
  opportunityId,
  dealName,
  currentPercent,
  proposal,
}: {
  opportunityId: string;
  dealName: string;
  currentPercent: number | null;
  proposal: CommissionProposal | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const valid =
    percent !== "" &&
    Number(percent) >= 0 &&
    Number(percent) <= 100 &&
    reason.trim().length >= 10;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    start(async () => {
      const result = await proposeCommission({
        opportunityId,
        percent: Number(percent),
        reason,
      });
      if (result.ok) {
        setOpen(false);
        setPercent("");
        setReason("");
        router.refresh();
      } else setError(result.error);
    });
  }

  function onWithdraw() {
    if (!proposal) return;
    if (!window.confirm("Withdraw your request on this deal?")) return;
    setError(null);
    start(async () => {
      const result = await withdrawProposal(proposal.id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  // An answered request: show what we said, and let them ask again.
  if (proposal && proposal.status !== "PENDING") {
    const approved = proposal.status === "APPROVED";
    return (
      <div className="space-y-2">
        <Alert tone={approved ? "success" : "info"}>
          <p className="flex items-center gap-2 text-sm font-medium">
            {approved ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {approved
              ? `Agreed at ${proposal.approvedPercent}%`
              : "We could not agree that rate"}
            {proposal.decidedAt && (
              <span className="font-normal text-muted-foreground">
                · {formatDate(proposal.decidedAt)}
              </span>
            )}
          </p>
          {approved && proposal.approvedPercent !== proposal.proposedPercent && (
            <p className="mt-1 text-xs text-muted-foreground">
              You asked for {proposal.proposedPercent}%.
            </p>
          )}
          {proposal.decisionNote && (
            <p className="mt-1 text-sm whitespace-pre-line">{proposal.decisionNote}</p>
          )}
        </Alert>
        {!open && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Ask again
          </Button>
        )}
      </div>
    );
  }

  // An open request: nothing to do but wait, or take it back.
  if (proposal && !open) {
    return (
      <div className="space-y-2">
        <Alert tone="info">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <Clock className="h-4 w-4" />
            <span className="font-medium">
              You asked for {proposal.proposedPercent}% on this deal.
            </span>
            <Badge tone="warning">Waiting on us</Badge>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Raised {formatDate(proposal.createdAt)}. Your rate stays as it is until we answer.
          </p>
        </Alert>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button size="sm" variant="ghost" onClick={onWithdraw} disabled={pending}>
          Withdraw the request
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Percent className="h-4 w-4" /> Ask for a different rate
      </Button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-dashed p-3">
      {error && <Alert tone="danger">{error}</Alert>}

      <p className="text-sm text-muted-foreground">
        Asking for a different rate on <strong>{dealName}</strong>
        {currentPercent !== null && <> — you are on {currentPercent}% today</>}.
        This is a request; your rate does not change until we agree it.
      </p>

      <Field label="Rate you are asking for (%)" required>
        <Input
          id={`rate-${opportunityId}`}
          type="number"
          step="0.01"
          min="0"
          max="100"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          required
          placeholder="15"
        />
      </Field>

      <Field
        label="Why this deal"
        required
        help="What makes it different from your usual work — the effort involved, what you did, what it cost you."
      >
        <Textarea
          id={`reason-${opportunityId}`}
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          minLength={10}
          maxLength={2000}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={pending || !valid}>
          {pending ? "Sending…" : "Send the request"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
