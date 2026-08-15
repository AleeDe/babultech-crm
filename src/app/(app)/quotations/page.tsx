import Link from "next/link";
import { Plus } from "lucide-react";
import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Button, Forbidden
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

export default async function QuotationsPage() {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="quotations" />;
  const db = await supabaseServer();

  const { data: quoteRows } = await db
    .from("quotation")
    .select(
      `*,
       account ( id, name ),
       opportunity ( id, name, opportunityNumber ),
       contact ( firstName, lastName ),
       lines:quote_line ( count )`,
    )
    .is("deletedAt", null)
    .order("quoteDate", { ascending: false })
    .order("versionNumber", { ascending: false });

  const quotes = (quoteRows ?? []).map((q) => ({
    ...q,
    account: one(q.account as never),
    opportunity: one(q.opportunity as never),
    contact: one(q.contact as never),
    _count: { lines: (q.lines as { count: number }[] | undefined)?.[0]?.count ?? 0 },
  }));

  const pendingApproval = quotes.filter((q) => q.approvalStatus === "PENDING");
  // expiryDate is an ISO string under PostgREST, so it has to be parsed before
  // comparing — `string < Date` is always false and this tile would read zero.
  const expiringSoon = quotes.filter(
    (q) =>
      ["SENT", "APPROVED"].includes(q.status) &&
      new Date(q.expiryDate as string) < new Date(Date.now() + 7 * 86_400_000),
  );
  const accepted = quotes.filter((q) => q.status === "ACCEPTED");

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Versioned offers. Only one version per deal can be accepted, and accepted quotes are locked."
      >
        <Button asChild>
          <Link href="/quotations/new">
            <Plus className="h-4 w-4" /> New quote
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open quotes" value={String(quotes.filter((q) => ["DRAFT", "SENT", "APPROVED", "UNDER_REVIEW"].includes(q.status)).length)} />
        <StatTile label="Awaiting approval" value={String(pendingApproval.length)} tone={pendingApproval.length ? "warning" : "neutral"} />
        <StatTile label="Expiring in 7 days" value={String(expiringSoon.length)} tone={expiringSoon.length ? "danger" : "neutral"} />
        <StatTile
          label="Accepted value"
          value={formatMoney(accepted.reduce((s, q) => s + Number(q.totalAmount), 0))}
          tone="success"
        />
      </div>

      <Card className="mt-6">
        {quotes.length === 0 ? (
          <EmptyState
            title="No quotations yet"
            description="Quotes are raised against an opportunity. A deal needs an accepted quote before it can be won."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Quote</TH>
                <TH>Customer</TH>
                <TH>Deal</TH>
                <TH>Issued</TH>
                <TH>Expires</TH>
                <TH className="text-right">Total</TH>
                <TH>Approval</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {quotes.map((q) => {
                const expired = q.expiryDate < new Date() && !["ACCEPTED", "REJECTED"].includes(q.status);
                return (
                  <TR key={q.id}>
                    <TD>
                      <Link href={`/quotations/${q.id}`} className="font-mono text-xs hover:underline">
                        {q.quoteNumber}
                      </Link>
                      <p className="text-xs text-muted-foreground">v{q.versionNumber} · {q._count.lines} lines</p>
                    </TD>
                    <TD className="text-sm">
                      <Link href={`/accounts/${q.account.id}`} className="hover:underline">
                        {q.account.name}
                      </Link>
                    </TD>
                    <TD className="text-sm">
                      <Link href={`/opportunities/${q.opportunity.id}`} className="hover:underline">
                        {q.opportunity.name}
                      </Link>
                    </TD>
                    <TD className="text-sm">{formatDate(q.quoteDate)}</TD>
                    <TD className={`text-sm ${expired ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatDate(q.expiryDate)}
                    </TD>
                    <TD className="text-right font-medium tabular">
                      {formatMoney(q.totalAmount, q.currencyCode)}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(q.approvalStatus)}>{humanize(q.approvalStatus)}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(q.status)}>{humanize(q.status)}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
