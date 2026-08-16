import { getPayableFormOptions } from "@/server/payables";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Alert } from "@/components/ui";
import { BillForm, type BillFormOptions } from "../bill-form";

export default async function NewVendorBillPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.INVOICE_WRITE)) return <Forbidden what="entering vendor bills" />;

  const { vendors, projects, categories, taxRates, currencies } = await getPayableFormOptions();

  const options: BillFormOptions = { vendors, projects, categories, taxRates, currencies };

  return (
    <>
      <PageHeader
        title="New vendor bill"
        description="What a supplier has invoiced you. It becomes payable once approved."
      />

      {vendors.length === 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            No supplier accounts yet. Create an account with its type set to Vendor first.
          </Alert>
        </div>
      )}

      <div className="max-w-3xl">
        <BillForm options={options} />
      </div>
    </>
  );
}
