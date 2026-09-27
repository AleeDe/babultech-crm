"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Handshake } from "lucide-react";
import { changeStage } from "@/server/opportunities";
import { setDealPartner } from "@/server/partner-commissions";
import {
  Button, Card, CardHeader, CardTitle, CardContent, Field, Input,
  Select, Badge, Alert, statusTone,
} from "@/components/ui";
import { PicklistOptions } from "@/components/picklist";
import { formatPercent, formatMoney, formatDate, humanize } from "@/lib/utils";

const ALL_STAGES = [
  "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
  "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION",
  "CLOSED_WON", "CLOSED_LOST", "ON_HOLD",
];

interface DealCommission {
  id: string;
  commissionNumber: string;
  status: string;
  commissionPercent: string | number;
  commissionAmount: string | number;
  withholdingAmount: string | number;
  partnerAmount: string | number;
  currencyCode: string;
  paymentDate: string | null;
  rejectedReason: string | null;
  requestStatus: string | null;
}

/**
 * The deal's partner, and what they will be paid on it.
 *
 * A deal takes its partner from its account when it is created, so most deals
 * never need this card to do anything. A deal raised before its account had a
 * partner can be given one here - once. Credit decides who is paid, so it is
 * never moved to another partner afterwards.
 *
 * The commission shown is live: it follows the deal's amount until it is paid
 * or rejected. Decisions about it are made on the commission record itself.
 */
export function DealPartnerPanel({
  opportunityId,
  partner,
  commission,
  canSeeCommission,
  canSetPartner,
  availablePartners,
}: {
  opportunityId: string;
  partner: { id: string; displayName: string; partnerNumber: string; status: string } | null;
  commission: DealCommission | null;
  canSeeCommission: boolean;
  canSetPartner: boolean;
  availablePartners: { id: string; displayName: string; partnerNumber: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);

  function attach() {
    if (!choice) return;
    setError(null);
    startTransition(async () => {
      const result = await setDealPartner(opportunityId, choice);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Partner</CardTitle>
        {commission && canSeeCommission && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/commissions/${commission.id}`}>Open commission</Link>
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {error && <Alert tone="danger">{error}</Alert>}

        {!partner ? (
          canSetPartner && availablePartners.length > 0 ? (
            <div className="space-y-2">
              <p className="text-muted-foreground">
                No partner on this deal. If a partner brought this customer, add them here. It
                starts their commission record, and cannot be moved to another partner later.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-56 flex-1">
                  <Field label="Partner">
                    <Select value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Partner">
                      <option value="">Choose a partner…</option>
                      {availablePartners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName} ({p.partnerNumber})
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
                <Button size="sm" onClick={attach} disabled={!choice || pending}>
                  {pending ? "Adding…" : "Add partner"}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No partner on this deal.</p>
          )
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Handshake className="h-4 w-4 text-muted-foreground" />
              <Link href={`/partners/${partner.id}`} className="font-medium hover:underline">
                {partner.displayName}
              </Link>
              <span className="font-mono text-xs text-muted-foreground">{partner.partnerNumber}</span>
              {partner.status !== "ACTIVE" && <Badge tone="warning">{humanize(partner.status)}</Badge>}
            </div>

            {!canSeeCommission ? null : !commission ? (
              <p className="text-muted-foreground">
                No commission record. Commission is recorded only for active partners.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Figure label="Commission">
                  {formatMoney(commission.commissionAmount, commission.currencyCode)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    at {formatPercent(commission.commissionPercent, 2)}
                  </span>
                </Figure>
                <Figure label="Withholding tax">
                  {formatMoney(commission.withholdingAmount, commission.currencyCode)}
                </Figure>
                <Figure label="Partner is paid">
                  <span className="font-semibold">
                    {formatMoney(commission.partnerAmount, commission.currencyCode)}
                  </span>
                </Figure>
                <Figure label="Status">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(commission.status)}>{humanize(commission.status)}</Badge>
                    {commission.requestStatus === "PENDING" && (
                      <Badge tone="warning">Rate request waiting</Badge>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {commission.status === "REJECTED"
                      ? commission.rejectedReason
                      : commission.paymentDate
                        ? `Payment date ${formatDate(commission.paymentDate)}`
                        : "Payment date is set when the deal is won"}
                  </span>
                </Figure>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5 tabular">{children}</div>
    </div>
  );
}

export function StageControl({
  opportunityId,
  currentStage,
}: {
  opportunityId: string;
  currentStage: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function onChange(formData: FormData) {
    setError(null);
    setSuccess(null);
    const stage = String(formData.get("stage"));

    startTransition(async () => {
      const result = await changeStage({
        id: opportunityId,
        stage: stage as never,
        lossReason: (formData.get("lossReason") as string) || null,
        competitorName: (formData.get("competitorName") as string) || null,
      });

      if (result.ok) {
        const parts = ["Stage updated."];
        if (result.data.project) {
          parts.push(`Project ${result.data.project.projectNumber} created for delivery.`);
        }
        if (result.data.projectError) {
          parts.push(`The delivery project could not be created: ${result.data.projectError}`);
        }
        setSuccess(parts.join(" "));
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  const [stage, setStage] = useState(currentStage);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Move stage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {success && <Alert tone="success">{success}</Alert>}

        <form action={onChange} className="space-y-3">
          <Field label="Stage"
            help="Where the deal stands. Winning or losing it also moves the partner's commission.">
            <Select name="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
              <PicklistOptions list="opportunity_stage" fallback={ALL_STAGES} within={ALL_STAGES} current={stage} />
            </Select>
          </Field>

          {stage === "CLOSED_LOST" && (
            <>
              <Field label="Loss reason" required hint="Required before a deal can be marked lost."
            help="Why it was lost. The single most useful field in the system when you read them all together.">
                <Input name="lossReason" required placeholder="Price, timing, went with a competitor…" />
              </Field>
              <Field label="Competitor"
            help="Who else is bidding, if you know.">
                <Input name="competitorName" />
              </Field>
            </>
          )}

          {stage === "CLOSED_WON" && (
            <Alert tone="info">
              Winning this deal needs an accepted quotation. If it has a partner, their commission
              payment date is set 90 days from today.
            </Alert>
          )}

          <Button type="submit" size="sm" disabled={pending || stage === currentStage}>
            {pending ? "Updating…" : "Update stage"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
