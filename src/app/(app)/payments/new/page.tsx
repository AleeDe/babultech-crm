import { prisma } from "@/lib/prisma";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { PaymentForm, type OpenInvoice } from "../payment-form";

export default async function NewPaymentPage() {
  await requirePermission(PERMISSIONS.PAYMENT_WRITE);

  const [accounts, currencies, openInvoices] = await Promise.all([
    prisma.account.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.currency.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ["DRAFT", "CANCELLED", "PAID", "WRITTEN_OFF"] },
        outstandingAmount: { gt: 0 },
      },
      select: {
        id: true, accountId: true, invoiceNumber: true, invoiceDate: true, dueDate: true,
        totalAmount: true, outstandingAmount: true, currencyCode: true, status: true,
      },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  // Grouped so the client can swap the invoice list instantly when the
  // customer changes, without another round trip.
  const invoicesByAccount: Record<string, OpenInvoice[]> = {};
  for (const inv of serialize(openInvoices) as unknown as (OpenInvoice & { accountId: string })[]) {
    (invoicesByAccount[inv.accountId] ??= []).push(inv);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Record a payment"
        description="Apply it against open invoices as you record it. Cleared cash is what settles a balance and what most commission plans pay on."
      />
      <PaymentForm
        accounts={accounts}
        currencies={serialize(currencies)}
        invoicesByAccount={invoicesByAccount}
      />
    </div>
  );
}
