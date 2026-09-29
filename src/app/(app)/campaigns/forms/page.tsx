import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listWebForms } from "@/server/web-forms";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState, Forbidden } from "@/components/ui";
import { formatDate } from "@/lib/utils";

export default async function WebFormsPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="website forms" />;
  const forms = await listWebForms();
  return (
    <>
      <PageHeader
        backTo="/campaigns"
        backLabel="Back to campaigns"
        title="Website forms"
        description="Forms on your website that send sign-ups here as prospects, each belonging to a campaign. Add one from its campaign's page."
      />
      <Card>
        {forms.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No website forms yet" description="Open a campaign and choose New form under Website forms." />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Form</TH>
                <TH>Campaign</TH>
                <TH className="text-right">Submissions</TH>
                <TH priority="secondary">Made</TH>
                <TH>State</TH>
              </TR>
            </THead>
            <TBody>
              {forms.map((f) => (
                <TR key={f.id}>
                  <TD className="text-sm font-medium"><Link href={`/campaigns/forms/${f.id}`} className="hover:underline">{f.name}</Link></TD>
                  <TD className="text-sm">{f.campaign ? <Link href={`/campaigns/${f.campaign.id}`} className="hover:underline">{f.campaign.name}</Link> : "—"}</TD>
                  <TD className="text-right text-sm tabular-nums">{f.submissionCount}</TD>
                  <TD className="text-sm" priority="secondary">{formatDate(f.createdAt)}</TD>
                  <TD><Badge tone={f.active ? "success" : "neutral"}>{f.active ? "Live" : "Off"}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
