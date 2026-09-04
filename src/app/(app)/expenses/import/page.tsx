import { getPayableFormOptions } from "@/server/payables";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { ExpenseImportForm } from "./import-form";

export default async function ExpenseImportPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.EXPENSE_WRITE)) return <Forbidden what="expenses" />;

  const options = await getPayableFormOptions();

  return (
    <>
      <PageHeader
        backTo="/expenses"
        backLabel="Back to expenses"
        title="Import expenses"
        description="Upload a CSV from your spreadsheet, or paste the rows. Everything is previewed and checked before anything is written."
      />
      <ExpenseImportForm
        categories={options.categories}
        vendors={options.vendors}
        users={options.users}
        projects={options.projects}
        currencies={options.currencies}
      />
    </>
  );
}
