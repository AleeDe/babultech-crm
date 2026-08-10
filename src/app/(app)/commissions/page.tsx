import Link from "next/link";
import { listCommissions, getCommissionTotals } from "@/server/commissions";
import { prisma } from "@/lib/prisma";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, StatTile, Button, Select, Input, Alert, Forbidden
} from "@/components/ui";
import { formatMoney, humanize, serialize } from "@/lib/utils";
import { CommissionTable } from "./commission-table";

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; partnerId?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.COMMISSION_READ)) return <Forbidden what="commissions" />;

  const params = await searchParams;

  const [records, totals, partners] = await Promise.all([
    listCommissions(params),
    getCommissionTotals(),
    prisma.partner.findMany({
      where: { deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader
        title="Commissions"
        description="Everything owed to partners, from accrual through approval to payment."
      >
        <Button asChild variant="outline">
          <Link href="/commissions/payouts">Payouts</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Accrued" value={formatMoney(totals.accrued.amount)} sublabel={`${totals.accrued.count} records`} tone="info" />
        <StatTile label="Pending approval" value={formatMoney(totals.pendingApproval.amount)} sublabel={`${totals.pendingApproval.count} records`} tone="warning" />
        <StatTile label="Payable" value={formatMoney(totals.payable.amount)} sublabel={`${totals.payable.count} records`} tone="warning" />
        <StatTile label="Paid" value={formatMoney(totals.paid.amount)} sublabel={`${totals.paid.count} records`} tone="success" />
        <StatTile label="Clawed back" value={formatMoney(totals.clawedBack.amount)} sublabel={`${totals.clawedBack.count} reversals`} tone="danger" />
      </div>

      {totals.pendingApproval.count > 0 && (
        <div className="mt-6">
          <Alert tone="warning">
            {totals.pendingApproval.count} commission{totals.pendingApproval.count === 1 ? "" : "s"} totalling{" "}
            {formatMoney(totals.pendingApproval.amount)} are waiting on your approval.
          </Alert>
        </div>
      )}

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <Select name="status" defaultValue={params.status ?? ""} className="w-52">
            <option value="">All statuses</option>
            {["ACCRUED", "PENDING_APPROVAL", "APPROVED", "PAYABLE", "PAID", "REJECTED", "CLAWED_BACK"].map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Select name="partnerId" defaultValue={params.partnerId ?? ""} className="w-60">
            <option value="">All partners</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        <div className="p-4">
          <CommissionTable rows={serialize(records) as never} />
        </div>
      </Card>
    </>
  );
}
