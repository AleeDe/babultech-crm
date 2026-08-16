"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { linkPartnerToOpportunity, unlinkPartnerFromOpportunity } from "@/server/partners";
import { changeStage } from "@/server/opportunities";
import {
  Button, Card, CardHeader, CardTitle, CardContent, Field, Input,
  Select, Badge, Alert, Table, THead, TBody, TR, TH, TD,
} from "@/components/ui";
import { formatPercent, formatMoney, humanize } from "@/lib/utils";

interface PartnerLink {
  id: string;
  role: string;
  revenueSharePercent: string;
  commissionPercentOverride: string | null;
  registrationExpiresAt: string | null;
  partner: {
    id: string;
    partnerNumber: string;
    displayName: string;
    kind: string;
    partnerType: string;
    defaultCommissionPercent: string | null;
    commissionPlan: { name: string; flatPercent: string | null; rateType: string } | null;
  };
}

/**
 * Attach partners to a deal and see, before the deal closes, roughly what each
 * will be owed. The estimate is indicative — the authoritative figure is what
 * the engine computes at trigger time against the snapshotted plan.
 */
export function PartnerPanel({
  opportunityId,
  amount,
  currencyCode,
  links,
  availablePartners,
}: {
  opportunityId: string;
  amount: string;
  currencyCode: string;
  links: PartnerLink[];
  availablePartners: { id: string; displayName: string; partnerNumber: string; kind: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usedShare = links.reduce((s, l) => s + Number(l.revenueSharePercent), 0);
  const remainingShare = Math.max(0, 100 - usedShare);

  const alreadyLinked = new Set(links.map((l) => l.partner?.id));
  const selectable = availablePartners.filter((p) => !alreadyLinked.has(p.id));

  function estimate(link: PartnerLink): number | null {
    const rate =
      link.commissionPercentOverride ??
      (link.partner?.commissionPlan?.rateType === "FLAT_PERCENT"
        ? link.partner?.commissionPlan?.flatPercent
        : null) ??
      link.partner?.defaultCommissionPercent;

    if (rate === null || rate === undefined) return null;
    return (Number(amount) * Number(link.revenueSharePercent) * Number(rate)) / 10_000;
  }

  function onAdd(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await linkPartnerToOpportunity({
        opportunityId,
        partnerId: String(formData.get("partnerId")),
        role: String(formData.get("role")) as never,
        revenueSharePercent: Number(formData.get("revenueSharePercent")),
        commissionPercentOverride: formData.get("commissionPercentOverride")
          ? Number(formData.get("commissionPercentOverride"))
          : null,
        registrationExpiresAt: formData.get("registrationExpiresAt")
          ? new Date(String(formData.get("registrationExpiresAt")))
          : null,
      });
      if (result.ok) {
        setAdding(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function onRemove(linkId: string) {
    setError(null);
    startTransition(async () => {
      const result = await unlinkPartnerFromOpportunity(linkId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Partners on this deal</CardTitle>
        {!adding && remainingShare > 0 && selectable.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Attach partner
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        {links.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">
            No partner involved. Attach one to credit them with the deal and generate commission
            automatically when it closes.
          </p>
        )}

        {links.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>Partner</TH>
                <TH>Role</TH>
                <TH className="text-right">Share</TH>
                <TH>Rate source</TH>
                <TH className="text-right">Est. commission</TH>
                <TH className="w-10" />
              </TR>
            </THead>
            <TBody>
              {links.map((l) => {
                const est = estimate(l);
                return (
                  <TR key={l.id}>
                    <TD>
                      <Link href={`/partners/${l.partner?.id}`} className="text-sm font-medium hover:underline">
                        {l.partner?.displayName}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {l.partner?.kind === "INDIVIDUAL" ? "Individual" : "Company"} ·{" "}
                        {humanize(l.partner?.partnerType)}
                      </p>
                    </TD>
                    <TD>
                      <Badge tone="neutral">{humanize(l.role)}</Badge>
                    </TD>
                    <TD className="text-right tabular">{formatPercent(l.revenueSharePercent, 0)}</TD>
                    <TD className="text-sm text-muted-foreground">
                      {l.commissionPercentOverride
                        ? `Override ${formatPercent(l.commissionPercentOverride)}`
                        : l.partner?.commissionPlan
                          ? l.partner?.commissionPlan?.name
                          : `Default ${formatPercent(l.partner?.defaultCommissionPercent)}`}
                    </TD>
                    <TD className="text-right tabular">
                      {est === null ? (
                        <span className="text-muted-foreground">tiered</span>
                      ) : (
                        formatMoney(est, currencyCode)
                      )}
                    </TD>
                    <TD>
                      <button
                        onClick={() => onRemove(l.id)}
                        disabled={pending}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${l.partner?.displayName}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}

        {links.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {formatPercent(usedShare, 0)} of the deal is credited to partners; {formatPercent(remainingShare, 0)}{" "}
            remains unallocated. Estimates use the current rate — the ledger figure is computed against the
            plan snapshotted when the partner was attached.
          </p>
        )}

        {adding && (
          <form action={onAdd} className="grid gap-4 rounded-md border bg-muted/30 p-4 sm:grid-cols-2">
            <Field label="Partner" required>
              <Select name="partnerId" required>
                <option value="">Select a partner…</option>
                {selectable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} ({p.kind === "INDIVIDUAL" ? "individual" : "company"})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Role" required>
              <Select name="role" required defaultValue="SOURCED">
                {["SOURCED", "INFLUENCED", "RESOLD", "DELIVERED"].map((r) => (
                  <option key={r} value={r}>{humanize(r)}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Revenue share %"
              required
              hint={`${formatPercent(remainingShare, 0)} unallocated on this deal.`}
            >
              <Input
                name="revenueSharePercent"
                type="number"
                step="0.01"
                min="0"
                max={remainingShare}
                defaultValue={remainingShare}
                required
              />
            </Field>
            <Field label="Commission % override" hint="Leave blank to use the partner's plan or default rate.">
              <Input name="commissionPercentOverride" type="number" step="0.01" min="0" max="100" />
            </Field>
            <Field label="Deal registration expires" hint="After this date the claim lapses and no commission accrues.">
              <Input name="registrationExpiresAt" type="date" />
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Attaching…" : "Attach"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setAdding(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** Stage transitions, including the win/loss rules and commission accrual. */
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
        setSuccess(
          result.data.commissionsCreated > 0
            ? `Stage updated. ${result.data.commissionsCreated} commission record${result.data.commissionsCreated === 1 ? "" : "s"} accrued.`
            : "Stage updated.",
        );
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
          <Field label="Stage">
            <Select name="stage" value={stage} onChange={(e) => setStage(e.target.value)}>
              {[
                "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED",
                "QUOTE_SUBMITTED", "NEGOTIATION", "VERBAL_CONFIRMATION",
                "CLOSED_WON", "CLOSED_LOST", "ON_HOLD",
              ].map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </Select>
          </Field>

          {stage === "CLOSED_LOST" && (
            <>
              <Field label="Loss reason" required hint="Required before a deal can be marked lost.">
                <Input name="lossReason" required placeholder="Price, timing, went with a competitor…" />
              </Field>
              <Field label="Competitor">
                <Input name="competitorName" />
              </Field>
            </>
          )}

          {stage === "CLOSED_WON" && (
            <Alert tone="info">
              Winning this deal needs an accepted quotation. Any partner on plans that pay on close
              will accrue commission immediately.
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
