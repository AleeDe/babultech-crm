"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Check, X, Banknote } from "lucide-react";
import { Button, Alert } from "@/components/ui";
import { setExpenseApproval, markExpensePaid } from "@/server/payables";

/**
 * The buttons that move an expense along.
 *
 * Which ones appear follows the same transition table the server enforces, so
 * the screen never offers a step that will be refused. The server is still the
 * one that decides — this only avoids showing a dead button.
 */
export function ExpenseActions({
  expenseId,
  approvalStatus,
  paymentStatus,
  canApprove,
  canPay,
  isOwnClaim,
}: {
  expenseId: string;
  approvalStatus: string;
  paymentStatus: string;
  canApprove: boolean;
  canPay: boolean;
  isOwnClaim: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.ok) router.refresh();
      else setError(result.error ?? "That did not work.");
    });
  }

  const settled = paymentStatus !== "UNPAID";

  return (
    <div className="space-y-3">
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="flex flex-wrap gap-2">
        {approvalStatus === "DRAFT" && (
          <Button onClick={() => run(() => setExpenseApproval(expenseId, "SUBMITTED"))} disabled={pending}>
            <Send className="h-4 w-4" /> Submit for approval
          </Button>
        )}

        {approvalStatus === "REJECTED" && (
          <Button onClick={() => run(() => setExpenseApproval(expenseId, "SUBMITTED"))} disabled={pending}>
            <Send className="h-4 w-4" /> Resubmit
          </Button>
        )}

        {approvalStatus === "SUBMITTED" && canApprove && !isOwnClaim && (
          <>
            <Button onClick={() => run(() => setExpenseApproval(expenseId, "APPROVED"))} disabled={pending}>
              <Check className="h-4 w-4" /> Approve
            </Button>
            <Button
              variant="outline"
              onClick={() => run(() => setExpenseApproval(expenseId, "REJECTED"))}
              disabled={pending}
            >
              <X className="h-4 w-4" /> Reject
            </Button>
          </>
        )}

        {approvalStatus === "SUBMITTED" && isOwnClaim && (
          <p className="text-sm text-muted-foreground">
            Waiting on someone else to approve - you cannot approve your own claim.
          </p>
        )}

        {approvalStatus === "APPROVED" && !settled && canPay && (
          <Button onClick={() => run(() => markExpensePaid(expenseId))} disabled={pending}>
            <Banknote className="h-4 w-4" /> Mark as settled
          </Button>
        )}
      </div>
    </div>
  );
}
