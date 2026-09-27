import Link from "next/link";
import { listPartnerCommissions, getPartnerCommissionTotals } from "@/server/partner-commissions";
import { supabaseServer } from "@/lib/supabase";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { ExportButton } from "@/components/export-button";
import {
  PageHeader, Card, StatTile, Button, Select, Input, Alert, Forbidden, Badge, statusTone,
  Table, THead, TBody, TR, TH, TD, EmptyState,
} from "@/components/ui";
import { formatMoney, formatPercent, formatDate, humanize, formatMoneyTotal } from "@/lib/utils";

/**
 * Partner commission: one record per deal with a partner.
 *
 * The views answer the questions asked of this list. "Due now" is the one to
 * work from: won deals whose payment date has come, which is what somebody has
 * to go and pay.
 */
const VIEWS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "open", label: "On open deals" },
  { value: "owed", label: "Owed on won deals" },
  { value: "due", label: "Due now" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
  { value: "requests", label: "Rate requests waiting" },
];

export default async function CommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; partnerId?: string; search?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.COMMISSION_READ)) return <Forbidden what="partner commission" />;

  const params = await searchParams;
  const [rows, totals, partners] = await Promise.all([
    listPartnerCommissions(params),
    getPartnerCommissionTotals(),
    (async () => {
      const db = await supabaseServer();
      const { data } = await db
        .from("partner")
        .select("id, displayName")
        .is("deletedAt", null)
        .order("displayName");
      return data ?? [];
    })(),
  ]);

  const view = VIEWS.find((v) => v.value === (params.view ?? "")) ?? VIEWS[0];
  // The tiles total the list, so they keep USD.
  const money = (v: unknown) => formatMoneyTotal(v as never, totals.currency);

  return (
    <>
      <PageHeader
        title="Partner commission"
        description="One record per deal with a partner. It follows the deal until it is marked paid or rejected."
      >
        <ExportButton
          entity="commissions"
          params={{ view: params.view, partnerId: params.partnerId, search: params.search }}
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="On open deals" value={money(totals.openTotal)} sublabel="Estimate, follows each deal" tone="info" />
        <StatTile label="Owed on won deals" value={money(totals.owedTotal)} sublabel={`${totals.owedCount} to pay`} tone="warning" />
        <StatTile
          label="Due now"
          value={money(totals.dueTotal)}
          sublabel={`${totals.dueCount} past their payment date`}
          tone={totals.dueCount > 0 ? "danger" : "neutral"}
        />
        <StatTile label="Paid" value={money(totals.paidTotal)} sublabel="Marked paid" tone="success" />
      </div>

      {totals.pendingRequests > 0 && can(me, PERMISSIONS.COMMISSION_APPROVE) && (
        <div className="mt-6">
          <Alert tone="warning">
            {totals.pendingRequests} partner{totals.pendingRequests === 1 ? " is" : "s are"} waiting on an
            answer to a rate request.{" "}
            <Link href="/commissions?view=requests" className="font-medium underline">
              See {totals.pendingRequests === 1 ? "it" : "them"}
            </Link>
          </Alert>
        </div>
      )}

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <Select name="view" defaultValue={params.view ?? ""} className="w-56" aria-label="View">
            {VIEWS.map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </Select>
          <Select name="partnerId" defaultValue={params.partnerId ?? ""} className="w-60" aria-label="Partner">
            <option value="">All partners</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>{p.displayName}</option>
            ))}
          </Select>
          <Input
            name="search"
            defaultValue={params.search ?? ""}
            placeholder="Number, partner, deal or customer"
            className="w-72"
            aria-label="Search"
          />
          <Button type="submit" variant="outline">Apply</Button>
        </form>

        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title={view.value ? `Nothing in "${view.label}"` : "No partner commission yet"}
              description="A record is created with every deal credited to an active partner."
            />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Deal</TH>
                <TH priority="secondary">Partner</TH>
                <TH priority="tertiary">Deal stage</TH>
                <TH priority="tertiary" className="text-right">Rate</TH>
                <TH className="text-right">Partner is paid</TH>
                <TH priority="secondary">Payment date</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/commissions/${r.id}`} className="font-medium hover:underline">
                      {r.opportunity?.name ?? r.commissionNumber}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-mono">{r.commissionNumber}</span>
                      {r.opportunity?.account?.name && ` · ${r.opportunity.account.name}`}
                    </p>
                  </TD>
                  <TD priority="secondary" className="text-sm">
                    {r.partner && (
                      <Link href={`/partners/${r.partner.id}`} className="hover:underline">
                        {r.partner.displayName}
                      </Link>
                    )}
                  </TD>
                  <TD priority="tertiary">
                    {r.opportunity && (
                      <Badge tone={statusTone(r.opportunity.stage)}>{humanize(r.opportunity.stage)}</Badge>
                    )}
                  </TD>
                  <TD priority="tertiary" className="text-right tabular">{formatPercent(r.commissionPercent, 2)}</TD>
                  <TD className="whitespace-nowrap text-right font-medium tabular">
                    {formatMoney(r.partnerAmount, r.currencyCode)}
                  </TD>
                  <TD priority="secondary" className="whitespace-nowrap text-sm">
                    {r.paymentDate ? formatDate(r.paymentDate) : <span className="text-muted-foreground">When won</span>}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
                      {r.requestStatus === "PENDING" && <Badge tone="warning">Rate request</Badge>}
                    </div>
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
