import Link from "next/link";
import { Plus } from "lucide-react";
import { listLeads } from "@/server/crm";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, Input, Select, Button, StatTile,
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

const STATUSES = [
  "NEW", "ASSIGNED", "ATTEMPTED_CONTACT", "CONTACTED", "DISCOVERY_SCHEDULED",
  "QUALIFIED", "NURTURING", "DISQUALIFIED", "CONVERTED",
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const leads = await listLeads(params);

  const open = leads.filter((l) => !["CONVERTED", "DISQUALIFIED"].includes(l.status));
  const partnerReferred = leads.filter((l) => l.referredByPartnerId).length;
  const pipelineValue = open.reduce((s, l) => s + Number(l.estimatedValue ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Unqualified prospects. Converting one creates the account, contact and deal — and carries any partner referral through."
      >
        <Button asChild>
          <Link href="/leads/new">
            <Plus className="h-4 w-4" /> New lead
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open leads" value={String(open.length)} />
        <StatTile label="Estimated value" value={formatMoney(pipelineValue)} tone="info" />
        <StatTile label="Partner-referred" value={String(partnerReferred)} sublabel="Credited on conversion" />
        <StatTile
          label="Converted"
          value={String(leads.filter((l) => l.status === "CONVERTED").length)}
          tone="success"
        />
      </div>

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-[220px] flex-1">
            <Input name="search" placeholder="Search name, company or number…" defaultValue={params.search} />
          </div>
          <Select name="status" defaultValue={params.status ?? ""} className="w-52">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {leads.length === 0 ? (
          <EmptyState title="No leads match" description="Leads arrive from campaigns, the website, or a partner referral." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Lead</TH>
                <TH>Company</TH>
                <TH>Source</TH>
                <TH>Referred by</TH>
                <TH>Owner</TH>
                <TH className="text-right">Est. value</TH>
                <TH>Follow up</TH>
                <TH>Status</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {leads.map((l) => {
                const overdue = l.nextFollowUpAt && l.nextFollowUpAt < new Date();
                return (
                  <TR key={l.id}>
                    <TD>
                      <span className="font-medium">
                        {l.firstName} {l.lastName}
                      </span>
                      <p className="text-xs text-muted-foreground">{l.leadNumber}</p>
                    </TD>
                    <TD className="text-sm">{l.companyName ?? "—"}</TD>
                    <TD className="text-sm text-muted-foreground">
                      {l.leadSource ?? "—"}
                      {l.campaign && <p className="text-xs">{l.campaign.name}</p>}
                    </TD>
                    <TD className="text-sm">
                      {l.referredByPartner ? (
                        <Link href={`/partners/${l.referredByPartner.id}`} className="text-primary hover:underline">
                          {l.referredByPartner.displayName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD className="text-sm text-muted-foreground">{l.owner.fullName}</TD>
                    <TD className="text-right tabular">{formatMoney(l.estimatedValue)}</TD>
                    <TD className={`text-sm ${overdue ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatDate(l.nextFollowUpAt)}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(l.status)}>{humanize(l.status)}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-right text-sm">
                      <Link href={`/leads/${l.id}/edit`} className="text-primary hover:underline">
                        {l.status === "CONVERTED" ? "View" : "Edit"}
                      </Link>
                      {l.status !== "CONVERTED" && (
                        <>
                          <span className="px-1.5 text-muted-foreground">·</span>
                          <Link href={`/leads/${l.id}/convert`} className="text-primary hover:underline">
                            Convert
                          </Link>
                        </>
                      )}
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
