import Link from "next/link";
import { notFound } from "next/navigation";
import { getInvoice, getBillingFormOptions } from "@/server/billing";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Alert, Button , Forbidden} from "@/components/ui";
import { serialize, humanize } from "@/lib/utils";
import { InvoiceForm, type InvoiceDefaults, type InvoiceFormOptions } from "../../invoice-form";

const EDITABLE = ["DRAFT", "APPROVED"];

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.INVOICE_WRITE)) return <Forbidden what="invoices" />;
  const [invoice, options] = await Promise.all([getInvoice(id), getBillingFormOptions()]);
  if (!invoice) notFound();

  if (!EDITABLE.includes(invoice.status)) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={invoice.invoiceNumber} description={humanize(invoice.status)} />
        <Alert tone="info">
          This invoice has been issued to the customer, so it is no longer editable — an issued
          invoice is an accounting document. Write off the balance if it will not be collected.
        </Alert>
        <div className="mt-4">
          <Button asChild>
            <Link href={`/invoices/${invoice.id}`}>Back to the invoice</Link>
          </Button>
        </div>
      </div>
    );
  }

  const defaults = serialize({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    accountId: invoice.accountId,
    contactId: invoice.contactId,
    projectId: invoice.projectId,
    contractId: invoice.contractId,
    milestoneId: invoice.milestoneId,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    currencyCode: invoice.currencyCode,
    paymentTermsDays: invoice.paymentTermsDays,
    notes: invoice.notes,
    lines: invoice.lines.map((l) => ({
      productId: l.productId,
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountPercent: l.discountPercent,
      taxRateId: l.taxRateId,
    })),
  }) as unknown as InvoiceDefaults;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={`Edit ${invoice.invoiceNumber}`} description="Draft" />
      <InvoiceForm options={serialize(options) as unknown as InvoiceFormOptions} defaults={defaults} />
    </div>
  );
}
