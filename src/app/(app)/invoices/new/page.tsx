import { getBillingFormOptions } from "@/server/billing";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { PageHeader } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { InvoiceForm, type InvoiceFormOptions } from "../invoice-form";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  await requirePermission(PERMISSIONS.INVOICE_WRITE);
  const [{ accountId }, options] = await Promise.all([searchParams, getBillingFormOptions()]);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="New invoice"
        description="Saved as a draft. Issuing it stamps any linked milestone as billed and is not reversible by editing."
      />
      <InvoiceForm
        options={serialize(options) as unknown as InvoiceFormOptions}
        lockedAccountId={accountId}
      />
    </div>
  );
}
