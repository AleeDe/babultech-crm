import { createExpense, createExpenseCategory, getPayableFormOptions } from "@/server/payables";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { ExpenseForm } from "../expense-form";

export default async function NewExpensePage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.EXPENSE_WRITE)) return <Forbidden what="recording expenses" />;

  const options = await getPayableFormOptions();

  return (
    <>
      <PageHeader
        backTo="/expenses"
        backLabel="Back to expenses"
        title="Record expense"
        description="Something the business paid for. On a project it can be billed on to the customer."
      />

      <div className="max-w-2xl">
        {/* The same form the edit page uses, so a rule cannot end up enforced
            on one and quietly missing on the other. */}
        <ExpenseForm
          action={createExpense}
          onCreateCategory={createExpenseCategory}
          options={options}
          // Whoever is recording it is usually the one owed the money.
          defaults={{ employeeUserId: me.id }}
          submitLabel="Record expense"
          redirectTo="/expenses"
        />
      </div>
    </>
  );
}
