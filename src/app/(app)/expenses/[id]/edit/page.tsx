import { notFound } from "next/navigation";
import {
  getExpense, updateExpense, createExpenseCategory, getPayableFormOptions,
} from "@/server/payables";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ExpenseForm } from "../../expense-form";

/**
 * Correcting an expense already on the ledger.
 *
 * The rules about what may be edited live on the server in updateExpense — an
 * approved or paid expense is locked, and a submitted claim belongs to its
 * approver. They are restated here as a notice rather than enforced, so the
 * reader learns why the form will refuse before they have filled it in; the
 * server is what actually decides.
 */
export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireUser();
  if (!can(me, PERMISSIONS.EXPENSE_WRITE)) return <Forbidden what="expenses" />;

  const [expense, options] = await Promise.all([getExpense(id), getPayableFormOptions()]);
  if (!expense) notFound();

  const locked =
    expense.approvalStatus === "APPROVED"
      ? "This expense has been approved, so it is locked. Ask an approver to reject it back to draft before changing it."
      : expense.paymentStatus === "PAID"
        ? "This expense has already been paid, so its record cannot be changed."
        : expense.approvalStatus === "SUBMITTED" && !can(me, PERMISSIONS.EXPENSE_APPROVE)
          ? "This claim is waiting on approval. Ask your approver to reject it back to you before changing it."
          : undefined;

  // Decimal and Date values cannot cross into a client component as they are.
  const defaults = serialize({
    categoryId: expense.categoryId,
    expenseDate: expense.expenseDate,
    amount: expense.amount,
    taxAmount: expense.taxAmount,
    currencyCode: expense.currencyCode,
    description: expense.description,
    employeeUserId: expense.employeeUserId,
    vendorAccountId: expense.vendorAccountId,
    projectId: expense.projectId,
    billableToCustomer: Boolean(expense.billableToCustomer),
    reimbursable: Boolean(expense.reimbursable),
  });

  // Bound here so the form stays a single-argument action like the create one.
  async function save(values: never) {
    "use server";
    return updateExpense(id, values);
  }

  return (
    <>
      <PageHeader
        backTo={`/expenses/${id}`}
        backLabel="Back to the expense"
        title={`Edit ${expense.expenseNumber}`}
        description="Every change here is recorded in the expense history, with who made it and when."
      />

      <div className="max-w-2xl">
        <ExpenseForm
          action={save}
          onCreateCategory={createExpenseCategory}
          options={options}
          defaults={defaults}
          submitLabel="Save changes"
          redirectTo={`/expenses/${id}`}
          notice={locked}
        />
      </div>
    </>
  );
}
