"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Check, X, Banknote } from "lucide-react";
import { Button, Alert, Input, Select, Field } from "@/components/ui";
import { PicklistOptions } from "@/components/picklist";
import { setVendorBillStatus, recordVendorPayment } from "@/server/payables";

/**
 * Approving a bill, and paying it.
 *
 * Payment is offered only once the bill is approved and still owes something,
 * because that is the only state the server will accept it in.
 */
export function BillActions({
  billId,
  vendorAccountId,
  status,
  outstanding,
  currencyCode,
  banks,
  canApprove,
  canPay,
}: {
  billId: string;
  vendorAccountId: string;
  status: string;
  outstanding: number;
  currencyCode: string;
  banks: { id: string; name: string }[];
  canApprove: boolean;
  canPay: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) {
        after?.();
        router.refresh();
      } else {
        setError(result.error ?? "That did not work.");
      }
    });
  }

  function pay(formData: FormData) {
    run(
      () =>
        recordVendorPayment({
          vendorAccountId,
          paymentDate: String(formData.get("paymentDate") ?? ""),
          amount: Number(formData.get("amount") ?? 0),
          currencyCode,
          paymentMethod: String(formData.get("paymentMethod") ?? "BANK") as never,
          bankAccountId: String(formData.get("bankAccountId") ?? "") || null,
          referenceNumber: String(formData.get("referenceNumber") ?? "") || null,
          // Paying from the bill's own screen means the whole payment goes
          // against this bill — there is nothing else in scope to split across.
          allocations: [
            { vendorBillId: billId, allocatedAmount: Number(formData.get("amount") ?? 0) },
          ],
        } as never),
      () => setPaying(false),
    );
  }

  const payable = ["APPROVED", "PARTIALLY_PAID", "OVERDUE"].includes(status) && outstanding > 0;

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        {status === "DRAFT" && (
          <Button onClick={() => run(() => setVendorBillStatus(billId, "UNDER_REVIEW"))} disabled={pending}>
            <Send className="h-4 w-4" /> Send for review
          </Button>
        )}

        {status === "UNDER_REVIEW" && canApprove && (
          <>
            <Button onClick={() => run(() => setVendorBillStatus(billId, "APPROVED"))} disabled={pending}>
              <Check className="h-4 w-4" /> Approve for payment
            </Button>
            <Button
              variant="outline"
              onClick={() => run(() => setVendorBillStatus(billId, "DRAFT"))}
              disabled={pending}
            >
              <X className="h-4 w-4" /> Send back
            </Button>
          </>
        )}

        {payable && canPay && !paying && (
          <Button onClick={() => setPaying(true)}>
            <Banknote className="h-4 w-4" /> Record payment
          </Button>
        )}

        {["DRAFT", "UNDER_REVIEW"].includes(status) && (
          <Button
            variant="ghost"
            onClick={() => run(() => setVendorBillStatus(billId, "CANCELLED"))}
            disabled={pending}
          >
            Cancel bill
          </Button>
        )}

        {status === "PAID" && (
          <p className="text-sm text-muted-foreground">Settled in full.</p>
        )}
      </div>

      {paying && (
        <form action={pay} className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount" required>
              <Input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                max={outstanding}
                required
                defaultValue={outstanding.toFixed(2)}
              />
            </Field>

            <Field label="Paid on" required>
              <Input
                name="paymentDate"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </Field>

            <Field label="Method" required>
              <Select name="paymentMethod" defaultValue="BANK">
                <PicklistOptions list="payment_method" fallback={["BANK", "CHEQUE", "CASH", "CARD", "WALLET"]} />
              </Select>
            </Field>

            <Field label="From account">
              <Select name="bankAccountId" defaultValue="">
                <option value="">Not recorded</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Reference">
            <Input name="referenceNumber" placeholder="Transfer or cheque number" />
          </Field>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setPaying(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Recording…" : "Record payment"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
