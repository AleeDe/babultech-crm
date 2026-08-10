"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePayout, markPayoutPaid } from "@/server/commissions";
import { Button, Alert, Select, Input, Field, Card } from "@/components/ui";

export function PayoutActions({
  payout,
  bankAccounts,
}: {
  payout: { id: string; status: string; payoutNumber: string; currencyCode: string };
  bankAccounts: { id: string; name: string; currencyCode: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  function onApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approvePayout(payout.id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function onPay(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await markPayoutPaid({
        payoutId: payout.id,
        paymentDate: new Date(String(formData.get("paymentDate"))),
        paymentMethod: String(formData.get("paymentMethod")) as never,
        bankAccountId: (formData.get("bankAccountId") as string) || null,
        referenceNumber: (formData.get("referenceNumber") as string) || null,
      });
      if (result.ok) {
        setPaying(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  // Paying out in a currency the bank account doesn't hold is a common slip.
  const matchingAccounts = bankAccounts.filter((b) => b.currencyCode === payout.currencyCode);

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}

      {payout.status === "DRAFT" && (
        <Button size="sm" onClick={onApprove} disabled={pending}>
          {pending ? "Approving…" : "Approve payout"}
        </Button>
      )}

      {payout.status === "APPROVED" && !paying && (
        <Button size="sm" onClick={() => setPaying(true)}>
          Record payment
        </Button>
      )}

      {payout.status === "APPROVED" && paying && (
        <Card className="p-4">
          <form action={onPay} className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment date" required>
              <Input name="paymentDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="Method" required>
              <Select name="paymentMethod" required defaultValue="BANK">
                {["BANK", "CHEQUE", "CASH", "CARD", "WALLET"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="Paying account"
              hint={
                matchingAccounts.length === 0
                  ? `No ${payout.currencyCode} account configured.`
                  : undefined
              }
            >
              <Select name="bankAccountId">
                <option value="">Not specified</option>
                {matchingAccounts.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Reference number">
              <Input name="referenceNumber" placeholder="Bank transfer / cheque no." />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Saving…" : "Mark as paid"}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setPaying(false)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
