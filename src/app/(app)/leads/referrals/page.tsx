import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listReferrals } from "@/server/marketing";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState, Forbidden } from "@/components/ui";

export default async function ReferralsPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="referrals" />;
  const rows = await listReferrals();
  const total = rows.reduce((s, r) => s + r.leads, 0);
  return (
    <>
      <PageHeader
        backTo="/leads"
        backLabel="Back to leads"
        title="Referrals"
        description={`Who sends us business: contacts named as a lead's referrer, and partners who registered leads. ${total} referred lead${total === 1 ? "" : "s"} in all.`}
      />
      <Card>
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No referrals yet" description="On a lead, set Referred by under Where they came from." />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Referred by</TH>
                <TH>Kind</TH>
                <TH className="text-right">Leads</TH>
                <TH className="text-right">Converted</TH>
                <TH className="text-right">Rate</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={`${r.referrer.kind}:${r.referrer.id}`}>
                  <TD className="text-sm font-medium">
                    <Link href={r.referrer.kind === "Contact" ? `/contacts/${r.referrer.id}` : `/partners/${r.referrer.id}`} className="hover:underline">
                      {r.referrer.name}
                    </Link>
                  </TD>
                  <TD><Badge tone={r.referrer.kind === "Partner" ? "warning" : "info"}>{r.referrer.kind}</Badge></TD>
                  <TD className="text-right text-sm tabular-nums">{r.leads}</TD>
                  <TD className="text-right text-sm tabular-nums">{r.converted}</TD>
                  <TD className="text-right text-sm tabular-nums">{Math.round((r.converted / r.leads) * 100)}%</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
