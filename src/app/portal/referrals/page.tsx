import Link from "next/link";
import { Plus } from "lucide-react";
import { getPortalReferrals } from "@/server/portal";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Button,
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

export default async function PortalReferralsPage() {
  const referrals = await getPortalReferrals();

  const converted = referrals.filter((r) => r.status === "CONVERTED");
  const open = referrals.filter((r) => !["CONVERTED", "DISQUALIFIED"].includes(r.status));
  const wonValue = converted.reduce(
    (s, r) => s + (r.convertedOpportunity?.stage === "CLOSED_WON" ? Number(r.convertedOpportunity.amount) : 0),
    0,
  );
  const conversionRate = referrals.length > 0 ? (converted.length / referrals.length) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Referrals"
        description="Leads you have sent us, and what became of them. A referral that converts attaches you to the resulting deal automatically."
      >
        <Button asChild>
          <Link href="/portal/register">
            <Plus className="h-4 w-4" /> Register a deal
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Referred" value={String(referrals.length)} />
        <StatTile label="Still in play" value={String(open.length)} tone="info" />
        <StatTile
          label="Converted"
          value={String(converted.length)}
          sublabel={`${conversionRate.toFixed(0)}% conversion`}
          tone={converted.length ? "success" : "neutral"}
        />
        <StatTile label="Won value" value={formatMoney(wonValue)} tone="success" />
      </div>

      <Card className="mt-6">
        {referrals.length === 0 ? (
          <EmptyState
            title="No referrals yet"
            description="Register a deal you are working and it will appear here so you can follow it through."
            action={
              <Button asChild>
                <Link href="/portal/register">Register your first deal</Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Referral</TH>
                <TH>Company</TH>
                <TH>Sent</TH>
                <TH className="text-right">Estimated</TH>
                <TH>Became</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {referrals.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <span className="text-sm font-medium">{r.firstName} {r.lastName}</span>
                    <p className="text-xs text-muted-foreground">{r.leadNumber}</p>
                  </TD>
                  <TD className="text-sm">{r.companyName ?? "—"}</TD>
                  <TD className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(r.createdAt)}
                  </TD>
                  <TD className="text-right tabular">{formatMoney(r.estimatedValue)}</TD>
                  <TD className="text-sm">
                    {r.convertedOpportunity ? (
                      <>
                        {r.convertedOpportunity.name}
                        <p className="text-xs text-muted-foreground">
                          {formatMoney(r.convertedOpportunity.amount, r.convertedOpportunity.currencyCode)}
                          {" · "}
                          {humanize(r.convertedOpportunity.stage)}
                        </p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(r.status)}>{humanize(r.status)}</Badge>
                    {r.status === "DISQUALIFIED" && r.disqualifiedReason && (
                      <p className="mt-0.5 max-w-[16rem] text-xs text-muted-foreground">
                        {r.disqualifiedReason}
                      </p>
                    )}
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
