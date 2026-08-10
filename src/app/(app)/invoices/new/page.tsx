import { getBillingFormOptions } from "@/server/billing";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { InvoiceForm, type InvoiceFormOptions } from "../invoice-form";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ accountId?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.INVOICE_WRITE)) return <Forbidden what="invoices" />;
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
