"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Percent, X } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Textarea, EmptyState,
} from "@/components/ui";
import { formatMoney, formatDate } from "@/lib/utils";
import {
  decideCommissionProposal, type CommissionProposal,
} from "@/server/commission-proposals";

/**
 * Rate requests from partners, and the answer.
 *
 * Approving writes the rate onto the deal in the same transaction, so what a
 * partner was told and what they are paid cannot disagree. The amount granted
 * is editable before approving because a counter-offer is the ordinary
 * outcome — meeting a partner halfway is agreement, not refusal, and forcing
 * it through "reject" would lose that in the record.
 */
export function RateRequestsPanel({ proposals }: { proposals: CommissionProposal[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [grant, setGrant] = useState("");
  const [note, setNote] = useState("");

  const open = proposals.filter((p) => p.status === "PENDING");
  const answered = proposals.filter((p) => p.status !== "PENDING").slice(0, 5);

  function begin(proposal: CommissionProposal) {
    setDeciding(proposal.id);
    setGrant(String(proposal.proposedPercent));
    setNote("");
    setError(null);
    setNotice(null);
  }

  function decide(proposal: CommissionProposal, approve: boolean) {
    setError(null);
    start(async () => {
      const result = await decideCommissionProposal({
        id: proposal.id,
        approve,
        percent: approve && grant !== "" ? Number(grant) : null,
        note,
      });

      if (result.ok) {
        setDeciding(null);
        setNotice(
          approve
            ? `${proposal.partner?.displayName ?? "The partner"} is now on ${result.data.percent}% for this deal.`
            : `${proposal.partner?.displayName ?? "The partner"} has been told, with your reason.`,
        );
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Percent className="h-4 w-4" /> Rate requests
          {open.length > 0 && <Badge tone="warning">{open.length} waiting</Badge>}
        </CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Partners asking for a different commission rate on a particular deal. Agreeing sets the
          rate on that deal immediately.
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {notice && <Alert tone="success">{notice}</Alert>}

        {open.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="When a partner asks for a different rate on a deal, it appears here with their reasoning."
          />
        ) : (
          <ul className="divide-y">
            {open.map((proposal) => (
              <li key={proposal.id} className="space-y-3 py-4 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {proposal.partner?.displayName ?? "Unknown partner"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <Link href={`/opportunities/${proposal.opportunityId}`} className="underline">
                        {proposal.opportunity?.name}
                      </Link>
                      {proposal.opportunity?.account?.name && ` · ${proposal.opportunity.account.name}`}
                      {proposal.opportunity &&
                        ` · ${formatMoney(proposal.opportunity.amount, proposal.opportunity.currencyCode)}`}
                      {` · asked ${formatDate(proposal.createdAt)}`}
                    </p>
                  </div>
                  <p className="text-sm tabular">
                    <span className="text-muted-foreground">
                      {proposal.currentPercent !== null ? `${proposal.currentPercent}%` : "no rate"}
                    </span>
                    {" → "}
                    <span className="font-medium">{proposal.proposedPercent}%</span>
                  </p>
                </div>

                <p className="whitespace-pre-line rounded-md bg-muted/40 p-3 text-sm">
                  {proposal.reason}
                </p>

                {deciding === proposal.id ? (
                  <div className="space-y-3 rounded-md border border-dashed p-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field
                        label="Rate to grant (%)"
                        help="Change it to meet them partway. That still counts as agreeing."
                      >
                        <Input
                          id={`grant-${proposal.id}`}
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={grant}
                          onChange={(e) => setGrant(e.target.value)}
                        />
                      </Field>
                    </div>
                    <Field
                      label="What to tell them"
                      help="Shown to the partner in their portal. Required if you are not agreeing."
                    >
                      <Textarea
                        id={`note-${proposal.id}`}
                        rows={2}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={2000}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={pending} onClick={() => decide(proposal, true)}>
                        <Check className="h-4 w-4" />
                        {pending ? "Saving…" : `Agree at ${grant || proposal.proposedPercent}%`}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending || !note.trim()}
                        title={note.trim() ? undefined : "Give them a reason first."}
                        onClick={() => decide(proposal, false)}
                      >
                        <X className="h-4 w-4" /> Do not agree
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeciding(null)} disabled={pending}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => begin(proposal)}>
                    Answer this
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {answered.length > 0 && (
          <div className="border-t pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Recently answered
            </p>
            <ul className="space-y-1.5 text-sm">
              {answered.map((proposal) => (
                <li key={proposal.id} className="flex flex-wrap items-baseline gap-2">
                  <Badge tone={proposal.status === "APPROVED" ? "success" : "neutral"}>
                    {proposal.status === "APPROVED" ? "Agreed" : proposal.status === "REJECTED" ? "Declined" : "Withdrawn"}
                  </Badge>
                  <span>{proposal.partner?.displayName}</span>
                  <span className="text-muted-foreground">{proposal.opportunity?.name}</span>
                  <span className="tabular text-muted-foreground">
                    {proposal.status === "APPROVED"
                      ? `at ${proposal.approvedPercent}%`
                      : `asked ${proposal.proposedPercent}%`}
                  </span>
                  {proposal.decidedAt && (
                    <span className="text-xs text-muted-foreground">{formatDate(proposal.decidedAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
