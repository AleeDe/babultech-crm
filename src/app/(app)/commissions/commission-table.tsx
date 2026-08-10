"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  approveCommissions, rejectCommissions, submitCommissionsForApproval,
  createPayout, clawbackCommission,
} from "@/server/commissions";
import {
  Button, Badge, statusTone, Table, THead, TBody, TR, TH, TD,
  EmptyState, Alert, Input,
} from "@/components/ui";
import { formatMoney, formatDate, formatPercent, humanize } from "@/lib/utils";

interface Row {
  id: string;
  commissionNumber: string;
  status: string;
  earnedDate: string;
  basisAmount: string;
  ratePercent: string | null;
  commissionAmount: string;
  withholdingTaxAmount: string;
  netPayableAmount: string;
  currencyCode: string;
  calculationNotes: string | null;
  payableFromDate: string | null;
  partner: { id: string; displayName: string; partnerNumber: string; kind: string };
  opportunity: { id: string; opportunityNumber: string; name: string; stage: string; account: { name: string } };
  plan: { name: string; basis: string; trigger: string } | null;
  payout: { id: string; payoutNumber: string; status: string } | null;
}

/**
 * The approval queue. Selection is deliberately constrained: a payout can only
 * batch records for one partner in one currency, so the "Create payout" button
 * stays disabled until the selection satisfies that.
 */
export function CommissionTable({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const partnerIds = new Set(selectedRows.map((r) => r.partner.id));
  const currencies = new Set(selectedRows.map((r) => r.currencyCode));
  const allPayable = selectedRows.length > 0 && selectedRows.every((r) => ["APPROVED", "PAYABLE"].includes(r.status) && !r.payout);
  const canPayout = allPayable && partnerIds.size === 1 && currencies.size === 1;

  const selectedTotal = selectedRows.reduce((s, r) => s + Number(r.netPayableAmount), 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, successText: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        setMessage({ tone: "success", text: successText });
        setSelected(new Set());
        router.refresh();
      } else {
        setMessage({ tone: "danger", text: result.error ?? "Something went wrong." });
      }
    });
  }

  return (
    <div className="space-y-4">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-4 py-3">
          <span className="text-sm">
            <strong>{selected.size}</strong> selected ·{" "}
            <span className="tabular">
              {currencies.size === 1
                ? formatMoney(selectedTotal, [...currencies][0])
                : `${selectedTotal.toFixed(2)} across ${currencies.size} currencies`}
            </span>
          </span>

          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => run(() => submitCommissionsForApproval([...selected]), "Submitted for approval.")}
            >
              Submit for approval
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => approveCommissions([...selected]), "Approved.")}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={() => {
                const reason = window.prompt("Why are these being rejected?");
                if (!reason) return;
                run(() => rejectCommissions({ recordIds: [...selected], reason }), "Rejected.");
              }}
            >
              Reject
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !canPayout}
              title={
                canPayout
                  ? undefined
                  : "Select approved, unpaid commissions for a single partner in a single currency."
              }
              onClick={() =>
                run(
                  () => createPayout({ partnerId: [...partnerIds][0], recordIds: [...selected] }),
                  "Payout created as a draft. Approve it to release payment.",
                )
              }
            >
              Create payout
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No commission records"
          description="Records appear automatically when a partner-attached deal hits its plan trigger — won, invoiced, or paid."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-10">
                <input
                  type="checkbox"
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-input"
                  aria-label="Select all"
                />
              </TH>
              <TH>Number</TH>
              <TH>Partner</TH>
              <TH>Deal</TH>
              <TH>Earned</TH>
              <TH className="text-right">Basis</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Gross</TH>
              <TH className="text-right">WHT</TH>
              <TH className="text-right">Net</TH>
              <TH>Status</TH>
              <TH className="w-8" />
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <TR>
                  <TD>
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 rounded border-input"
                      aria-label={`Select ${r.commissionNumber}`}
                    />
                  </TD>
                  <TD className="font-mono text-xs">{r.commissionNumber}</TD>
                  <TD>
                    <Link href={`/partners/${r.partner.id}`} className="text-sm font-medium hover:underline">
                      {r.partner.displayName}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {r.partner.kind === "INDIVIDUAL" ? "Individual" : "Company"}
                    </p>
                  </TD>
                  <TD>
                    <Link href={`/opportunities/${r.opportunity.id}`} className="text-sm hover:underline">
                      {r.opportunity.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{r.opportunity.account.name}</p>
                  </TD>
                  <TD className="text-sm">{formatDate(r.earnedDate)}</TD>
                  <TD className="text-right tabular">{formatMoney(r.basisAmount, r.currencyCode)}</TD>
                  <TD className="text-right tabular">{formatPercent(r.ratePercent)}</TD>
                  <TD className="text-right tabular">{formatMoney(r.commissionAmount, r.currencyCode)}</TD>
                  <TD className="text-right tabular text-muted-foreground">
                    {formatMoney(r.withholdingTaxAmount, r.currencyCode)}
                  </TD>
                  <TD className="text-right font-medium tabular">{formatMoney(r.netPayableAmount, r.currencyCode)}</TD>
                  <TD>
                    <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
                    {r.payout && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{r.payout.payoutNumber}</p>
                    )}
                  </TD>
                  <TD>
                    <button
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                      aria-label="Show calculation"
                    >
                      {expanded === r.id ? "−" : "?"}
                    </button>
                  </TD>
                </TR>
                {expanded === r.id && (
                  <TR>
                    <TD colSpan={12} className="bg-muted/30">
                      <div className="space-y-1.5 py-1 text-xs">
                        <p>
                          <span className="font-semibold">How this was calculated: </span>
                          {r.calculationNotes ?? "No calculation notes recorded."}
                        </p>
                        <p className="text-muted-foreground">
                          Plan: {r.plan?.name ?? "none (partner default rate)"}
                          {r.plan && ` · basis ${humanize(r.plan.basis)} · earned ${humanize(r.plan.trigger)}`}
                          {r.payableFromDate && ` · payable from ${formatDate(r.payableFromDate)}`}
                        </p>
                        {["ACCRUED", "PENDING_APPROVAL", "APPROVED", "PAYABLE", "PAID"].includes(r.status) && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="mt-1"
                            disabled={pending}
                            onClick={() => {
                              const reason = window.prompt("Reason for the clawback?");
                              if (!reason) return;
                              run(
                                () => clawbackCommission({ recordId: r.id, reason }),
                                "Clawback posted as a reversing entry.",
                              );
                            }}
                          >
                            Claw back
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                )}
              </Fragment>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
