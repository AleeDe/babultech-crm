import Link from "next/link";
import { Plus, Upload, Clock, Wallet, Receipt, Coins } from "lucide-react";
import { listExpenses, getExpenseTotals, getExpenseClaimSummary } from "@/server/payables";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { ExportButton } from "@/components/export-button";
import { ListFilters, optionsFrom } from "@/components/list-filters";
import { Pagination } from "@/components/pagination";
import {
  PageHeader, Card, EmptyState, StatTile, Button, Forbidden,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils";
import { ExpenseBulkTable } from "./expense-bulk-table";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    approvalStatus?: string;
    paymentStatus?: string;
    page?: string;
  }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.EXPENSE_READ)) return <Forbidden what="expenses" />;

  const params = await searchParams;
  const filters = {
    search: params.search,
    approvalStatus: params.approvalStatus,
    paymentStatus: params.paymentStatus,
  };

  const [expenses, totals, summary] = await Promise.all([
    listExpenses({ ...filters, page: Number(params.page) || 1 }),
    // Totals span every matching row, so the tiles do not shrink as you page.
    getExpenseTotals(filters),
    getExpenseClaimSummary(),
  ]);

  const filtered = Boolean(params.search || params.approvalStatus || params.paymentStatus);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="What the business spent, who is owed it, and whether the customer is paying for it."
      >
        <ExportButton entity="expenses" params={filters} />
        {can(me, PERMISSIONS.INVOICE_READ) && (
          <Button asChild variant="outline">
            <Link href="/vendor-bills">Vendor bills</Link>
          </Button>
        )}
        {can(me, PERMISSIONS.EXPENSE_WRITE) && (
          <>
            <Button asChild variant="outline">
              <Link href="/expenses/import">
                <Upload className="h-4 w-4" /> Import rows
              </Link>
            </Button>
            <Button asChild>
              <Link href="/expenses/new">
                <Plus className="h-4 w-4" /> Record expense
              </Link>
            </Button>
          </>
        )}
      </PageHeader>

      {/* The two tiles that carry an action are first: what is waiting on
          someone, and what is waiting on money. The two reference figures
          follow. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={<Clock className="h-4 w-4" />}
          label="Awaiting approval"
          value={formatMoney(summary.awaitingApproval)}
          sublabel={`${summary.awaitingApprovalCount} claim${summary.awaitingApprovalCount === 1 ? "" : "s"}`}
          tone={summary.awaitingApprovalCount > 0 ? "warning" : "neutral"}
          href="/expenses?approvalStatus=SUBMITTED"
        />
        <StatTile
          icon={<Wallet className="h-4 w-4" />}
          label="Approved, unpaid"
          value={formatMoney(summary.toPay)}
          sublabel={`${summary.toPayCount} to settle`}
          tone={summary.toPayCount > 0 ? "info" : "success"}
          href="/expenses?approvalStatus=APPROVED&paymentStatus=UNPAID"
        />
        <StatTile
          icon={<Receipt className="h-4 w-4" />}
          label="Billable to customers"
          value={formatMoney(totals.billableTotal)}
          sublabel={`${totals.billableCount} on projects`}
        />
        <StatTile
          icon={<Coins className="h-4 w-4" />}
          label={filtered ? "Total (filtered)" : "Total recorded"}
          value={formatMoney(totals.total)}
          sublabel={`${totals.count} expense${totals.count === 1 ? "" : "s"}`}
        />
      </div>

      <div className="mt-6">
        <ListFilters
          searchPlaceholder="Search number or description…"
          searchValue={params.search}
          selects={[
            {
              name: "approvalStatus",
              allLabel: "Any approval",
              value: params.approvalStatus,
              options: optionsFrom(["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]),
            },
            {
              name: "paymentStatus",
              allLabel: "Any payment",
              value: params.paymentStatus,
              options: optionsFrom(["UNPAID", "PAID", "REIMBURSED"]),
            },
          ]}
        />
      </div>

      <Card>
        {expenses.total === 0 ? (
          <EmptyState
            title={filtered ? "No expenses match those filters" : "No expenses yet"}
            description={
              filtered
                ? "Try a different status, or clear the search to see everything."
                : "Record what the business spends — rent, software, hardware, travel. Expenses on a project can be billed on to the customer."
            }
            action={
              filtered ? (
                <Button asChild variant="outline">
                  <Link href="/expenses">Clear filters</Link>
                </Button>
              ) : can(me, PERMISSIONS.EXPENSE_WRITE) ? (
                <Button asChild>
                  <Link href="/expenses/new">Record an expense</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ExpenseBulkTable
              expenses={expenses.rows}
              canApprove={can(me, PERMISSIONS.EXPENSE_APPROVE)}
              canPay={can(me, PERMISSIONS.EXPENSE_APPROVE)}
              currentUserId={me.id}
            />
            <Pagination
              page={expenses.page}
              pageCount={expenses.pageCount}
              total={expenses.total}
              pageSize={expenses.pageSize}
              params={filters}
            />
          </>
        )}
      </Card>
    </>
  );
}
