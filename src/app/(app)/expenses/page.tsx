import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { listExpenses, getPayablesSummary } from "@/server/payables";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { ListFilters, optionsFrom } from "@/components/list-filters";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Button, Forbidden,
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; approvalStatus?: string; paymentStatus?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.INVOICE_READ)) return <Forbidden what="expenses" />;

  const params = await searchParams;
  const [expenses, summary] = await Promise.all([listExpenses(params), getPayablesSummary()]);

  const billable = expenses.filter((e: Record<string, any>) => e.billableToCustomer);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="What the business spent, who is owed it, and whether the customer is paying for it."
      >
        <Button asChild variant="outline">
          <Link href="/vendor-bills">Vendor bills</Link>
        </Button>
        {can(me, PERMISSIONS.INVOICE_WRITE) && (
          <Button asChild>
            <Link href="/expenses/new">
              <Plus className="h-4 w-4" /> Record expense
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Awaiting approval"
          value={formatMoney(summary.expensesAwaitingApproval)}
          sublabel={`${summary.expensesAwaitingApprovalCount} claim(s)`}
          tone={summary.expensesAwaitingApprovalCount > 0 ? "warning" : "neutral"}
        />
        <StatTile
          label="Approved, unpaid"
          value={formatMoney(summary.expensesToPay)}
          sublabel={`${summary.expensesToPayCount} to settle`}
          tone={summary.expensesToPayCount > 0 ? "info" : "success"}
        />
        <StatTile
          label="Billable to customers"
          value={formatMoney(billable.reduce((s, e) => s + Number(e.amount), 0))}
          sublabel={`${billable.length} on projects`}
        />
        <StatTile label="Total recorded" value={String(expenses.length)} />
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
        {expenses.length === 0 ? (
          <EmptyState
            title="No expenses match"
            description="Record what the business spends — travel, subcontractors, software. Expenses on a project can be billed on to the customer."
            action={
              can(me, PERMISSIONS.INVOICE_WRITE) ? (
                <Button asChild>
                  <Link href="/expenses/new">Record an expense</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Expense</TH>
                <TH>Category</TH>
                <TH>Who</TH>
                <TH>Project</TH>
                <TH>Date</TH>
                <TH className="text-right">Amount</TH>
                <TH>Approval</TH>
                <TH>Payment</TH>
              </TR>
            </THead>
            <TBody>
              {expenses.map((e: Record<string, any>) => (
                <TR key={e.id}>
                  <TD>
                    <Link href={`/expenses/${e.id}`} className="font-mono text-xs hover:underline">
                      {e.expenseNumber}
                    </Link>
                    {e.description && (
                      <p className="max-w-[220px] truncate text-xs text-muted-foreground">
                        {e.description}
                      </p>
                    )}
                  </TD>
                  <TD className="text-sm">
                    {e.category?.name ?? "—"}
                    {e.category?.glCode && (
                      <p className="text-xs text-muted-foreground">{e.category.glCode}</p>
                    )}
                  </TD>
                  <TD className="text-sm">
                    {e.employee?.fullName ?? e.vendor?.name ?? "—"}
                    {e.reimbursable && e.employee && (
                      <p className="text-xs text-muted-foreground">Reimbursable</p>
                    )}
                  </TD>
                  <TD className="text-sm">
                    {e.project ? (
                      <Link href={`/projects/${e.project.id}`} className="hover:underline">
                        {e.project.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {e.billableToCustomer && (
                      <Badge tone="info" className="mt-0.5">
                        <Receipt className="h-3 w-3" /> Billable
                      </Badge>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-sm">{formatDate(e.expenseDate)}</TD>
                  <TD className="text-right font-medium tabular">
                    {formatMoney(e.amount, e.currencyCode)}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(e.approvalStatus)}>{humanize(e.approvalStatus)}</Badge>
                  </TD>
                  <TD>
                    <Badge tone={statusTone(e.paymentStatus)}>{humanize(e.paymentStatus)}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
