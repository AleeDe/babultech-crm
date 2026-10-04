import { notFound } from "next/navigation";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getPayment } from "@/server/billing";
import { PageHeader, Forbidden } from "@/components/ui";
import { CorrectionGate } from "@/components/correction-gate";
import { PaymentEditForm } from "./payment-edit-form";

/** Editing a payment: a pending one by anyone who records payments; a cleared one by an administrator's correction. */
export default async function EditPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.PAYMENT_WRITE)) return <Forbidden what="payments" />;
  const { id } = await params;
  const payment = await getPayment(id);
  if (!payment || payment.deletedAt) notFound();
  const allocations = ((payment as { allocations?: unknown[] }).allocations ?? []).length;

  return (
    <>
      <PageHeader backTo={`/payments/${id}`} backLabel="Back to the payment" title={`Edit ${payment.paymentNumber}`} />
      <div className="max-w-2xl">
        <CorrectionGate type="Payment" id={id}>
          <PaymentEditForm
            id={id}
            amountLocked={allocations > 0}
            initial={{
              paymentDate: String(payment.paymentDate).slice(0, 10),
              paymentMethod: String(payment.paymentMethod),
              referenceNumber: (payment.referenceNumber as string | null) ?? "",
              notes: (payment.notes as string | null) ?? "",
              amount: String(payment.amount),
            }}
          />
        </CorrectionGate>
      </div>
    </>
  );
}
