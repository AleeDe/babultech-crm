"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment } from "@/server/billing";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
} from "@/components/ui";
import { PicklistSelect } from "@/components/picklist-select";
import { cn, formatMoney, formatDate, humanize } from "@/lib/utils";

const METHODS = ["BANK", "CHEQUE", "CASH", "CARD", "WALLET"];

export interface OpenInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string;
  outstandingAmount: string;
  currencyCode: string;
  status: string;
}

/**
 * Record a receipt and apply it to invoices in one pass.
 *
 * Cash application is the bit people get wrong, so the form does the obvious
 * thing for them: "apply oldest first" fills the allocation the way an AR clerk
 * would, and the running unapplied figure makes over-application visible before
 * the server refuses it.
 */
export function PaymentForm({
  accounts,
  currencies,
  invoicesByAccount,
}: {
  accounts: { id: string; name: string }[];
  currencies: { code: string; name: string }[];
  invoicesByAccount: Record<string, OpenInvoice[]>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [accountId, setAccountId] = useState("");
  const [currency, setCurrency] = useState("PKR");
  const [amount, setAmount] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});

  const openInvoices = useMemo(
    () => (invoicesByAccount[accountId] ?? []).filter((i) => i.currencyCode === currency),
    [invoicesByAccount, accountId, currency],
  );

  const allocatedTotal = Object.values(allocations).reduce((s, v) => s + (Number(v) || 0), 0);
  const unapplied = (Number(amount) || 0) - allocatedTotal;
  const overApplied = unapplied < -0.005;

  /** Oldest due date first — standard AR practice. */
  function applyOldestFirst() {
    let remaining = Number(amount) || 0;
    const next: Record<string, string> = {};
    for (const inv of [...openInvoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
      if (remaining <= 0.005) break;
      const take = Math.min(remaining, Number(inv.outstandingAmount));
      next[inv.id] = take.toFixed(2);
      remaining -= take;
    }
    setAllocations(next);
  }

  // A submit HANDLER rather than <form action={...}>. React resets a form after
  // an action completes, and every field here is uncontrolled (defaultValue), so
  // with `action` a rejected submit cleared everything the user had typed and
  // made them fill the whole form in again to correct one field.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setError(null);
    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const applied = Object.entries(allocations)
      .filter(([, v]) => Number(v) > 0)
      .map(([invoiceId, v]) => ({ invoiceId, amount: v }));

    startTransition(async () => {
      const result = await recordPayment({
        accountId,
        paymentDate: get("paymentDate"),
        amount,
        currencyCode: currency,
        paymentMethod: get("paymentMethod"),
        referenceNumber: get("referenceNumber"),
        status: get("status"),
        notes: get("notes"),
        allocations: applied,
      } as never);

      if (result.ok) {
        router.push("/payments");
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Receipt</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Customer" required
            help="Who the money came from.">
            <Select
              name="accountId"
              required
              value={accountId}
              onChange={(e) => { setAccountId(e.target.value); setAllocations({}); }}
            >
              <option value="">Select a customer…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount received" required
            help="How much actually arrived, which is not always what was invoiced. Record short payments as they came in.">
            <Input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Currency" required hint="Cross-currency application is not supported."
            help="The currency it was received in.">
            <Select
              name="currencyCode"
              required
              value={currency}
              onChange={(e) => { setCurrency(e.target.value); setAllocations({}); }}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Received on" required
            help="The date the money reached the account, not the date they say they sent it.">
            <Input name="paymentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
          </Field>
          <Field label="Method" required
            help="How it arrived - bank transfer, cheque, cash. Helps when reconciling the statement.">
            <PicklistSelect list="payment_method" name="paymentMethod" required emptyLabel={null} fallback={METHODS} defaultValue="BANK" addLabel="Add a payment method" />
          </Field>
          <Field label="Reference"
            help="The bank reference or cheque number. This is what makes the payment findable on a statement later.">
            <Input name="referenceNumber" placeholder="Cheque or transfer reference" />
          </Field>
          <Field
            label="Status"
            required
            hint="Only cleared money settles an invoice or accrues commission."
            help="Whether the payment has cleared. Uncleared payments do not count as settled."
          >
            <Select name="status" required defaultValue="CLEARED">
              <option value="CLEARED">Cleared</option>
              <option value="PENDING">Pending clearance</option>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Apply to invoices</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Anything left unapplied sits as credit on the customer's account.
            </p>
          </div>
          {openInvoices.length > 0 && Number(amount) > 0 && (
            <Button type="button" variant="outline" size="sm" onClick={applyOldestFirst}>
              Apply oldest first
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-0">
          {!accountId ? (
            <p className="px-5 pb-2 text-sm text-muted-foreground">Choose a customer to see their open invoices.</p>
          ) : openInvoices.length === 0 ? (
            <p className="px-5 pb-2 text-sm text-muted-foreground">
              Nothing outstanding for this customer in {currency}. The receipt will be recorded as
              unapplied credit.
            </p>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Invoice</TH>
                    <TH>Due</TH>
                    <TH className="text-right">Total</TH>
                    <TH className="text-right">Outstanding</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Apply</TH>
                  </TR>
                </THead>
                <TBody>
                  {openInvoices.map((inv) => {
                    const late = new Date(inv.dueDate) < new Date();
                    const applied = Number(allocations[inv.id] ?? 0);
                    const over = applied > Number(inv.outstandingAmount) + 0.005;
                    return (
                      <TR key={inv.id}>
                        <TD className="font-mono text-xs">{inv.invoiceNumber}</TD>
                        <TD className={cn("text-sm", late && "text-red-600 dark:text-red-400")}>
                          {formatDate(inv.dueDate)}
                        </TD>
                        <TD className="text-right tabular">{formatMoney(inv.totalAmount, inv.currencyCode)}</TD>
                        <TD className="text-right tabular">{formatMoney(inv.outstandingAmount, inv.currencyCode)}</TD>
                        <TD><Badge tone={statusTone(inv.status)}>{humanize(inv.status)}</Badge></TD>
                        <TD className="text-right">
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            max={inv.outstandingAmount}
                            className={cn("ml-auto w-32 text-right", over && "border-destructive")}
                            value={allocations[inv.id] ?? ""}
                            onChange={(e) =>
                              setAllocations((prev) => ({ ...prev, [inv.id]: e.target.value }))
                            }
                          />
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>

              <div className="mt-3 space-y-1 border-t px-5 pt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Received</span>
                  <span className="tabular">{formatMoney(amount || 0, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Applied</span>
                  <span className="tabular">{formatMoney(allocatedTotal, currency)}</span>
                </div>
                <div className={cn("flex justify-between border-t pt-1 font-semibold", overApplied && "text-destructive")}>
                  <span>{overApplied ? "Over-applied by" : "Unapplied credit"}</span>
                  <span className="tabular">{formatMoney(Math.abs(unapplied), currency)}</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea name="notes" rows={3} />
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !accountId || !(Number(amount) > 0) || overApplied}>
          {pending ? "Recording…" : "Record payment"}
        </Button>
      </div>
    </form>
  );
}
