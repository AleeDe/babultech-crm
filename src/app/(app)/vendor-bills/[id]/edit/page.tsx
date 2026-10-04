import { notFound } from "next/navigation";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getVendorBill, getPayableFormOptions } from "@/server/payables";
import { PageHeader, Forbidden } from "@/components/ui";
import { CorrectionGate } from "@/components/correction-gate";
import { BillForm, type SavedBill } from "../../bill-form";

/** Editing a supplier bill: a draft by anyone who enters bills; after that, an administrator's correction. */
export default async function EditVendorBillPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.INVOICE_WRITE)) return <Forbidden what="supplier bills" />;
  const { id } = await params;
  const [bill, options] = await Promise.all([getVendorBill(id), getPayableFormOptions()]);
  if (!bill || bill.deletedAt) notFound();

  const saved: SavedBill = {
    id: bill.id as string,
    vendorAccountId: bill.vendorAccountId as string,
    vendorInvoiceNumber: (bill.vendorInvoiceNumber as string | null) ?? null,
    projectId: (bill.projectId as string | null) ?? null,
    billDate: String(bill.billDate),
    dueDate: String(bill.dueDate),
    currencyCode: String(bill.currencyCode ?? "PKR"),
    notes: (bill.notes as string | null) ?? null,
    lines: (bill.lines as Record<string, unknown>[]).map((l) => ({
      description: String(l.description ?? ""),
      quantity: String(l.quantity ?? "1"),
      unitCost: String(l.unitCost ?? "0"),
      expenseCategoryId: (l.expenseCategoryId as string | null) ?? null,
      taxRateId: (l.taxRateId as string | null) ?? null,
    })),
  };

  return (
    <>
      <PageHeader backTo={`/vendor-bills/${id}`} backLabel="Back to the bill" title={`Edit ${bill.billNumber}`} />
      <div className="max-w-3xl">
        <CorrectionGate type="VendorBill" id={id}>
          <BillForm
            options={{ vendors: options.vendors, projects: options.projects, categories: options.categories, taxRates: options.taxRates, currencies: options.currencies }}
            bill={saved}
          />
        </CorrectionGate>
      </div>
    </>
  );
}
