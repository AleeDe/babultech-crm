import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { listLeads } from "@/server/crm";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, Input, Select, Button, StatTile, Forbidden
} from "@/components/ui";
import { formatMoney, humanize, serialize } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { ExportButton } from "@/components/export-button";
import { LeadsTable } from "./leads-table";
import { getAssignableUsers } from "@/server/bulk";

const STATUSES = [
  "NEW", "ASSIGNED", "ATTEMPTED_CONTACT", "CONTACTED", "DISCOVERY_SCHEDULED",
  "QUALIFIED", "NURTURING", "DISQUALIFIED", "CONVERTED",
];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; source?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.LEAD_READ)) return <Forbidden what="leads" />;

  const params = await searchParams;
  const [leads, users] = await Promise.all([listLeads(params), getAssignableUsers()]);

  const open = leads.filter((l) => !["CONVERTED", "DISQUALIFIED"].includes(l.status));
  const partnerReferred = leads.filter((l) => l.referredByPartnerId).length;
  // Portal registrations nobody has looked at yet — the queue that matters.
  const awaitingReview = leads.filter(
    (l) => l.referredByPartnerId && l.status === "NEW",
  ).length;
  const pipelineValue = open.reduce((s, l) => s + Number(l.estimatedValue ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Unqualified prospects. Converting one creates the account, contact and deal - and carries any partner referral through."
      >
        <Button asChild variant="outline"><Link href="/leads/calling">My calling queue</Link></Button>
        <Button asChild variant="outline"><Link href="/leads/handoffs">Sales handoffs</Link></Button>
        <Button asChild variant="outline"><Link href="/leads/research">Research quality</Link></Button>
        <ExportButton entity="leads" params={{ search: params.search, status: params.status, source: params.source }} />
        {can(_me, PERMISSIONS.LEAD_WRITE) && (
          <Button asChild variant="outline">
            <Link href="/leads/import">
              <Upload className="h-4 w-4" /> Import
            </Link>
          </Button>
        )}
        <Button asChild>
          <Link href="/leads/new">
            <Plus className="h-4 w-4" /> New lead
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open leads" value={String(open.length)} />
        <StatTile label="Estimated value" value={formatMoney(pipelineValue)} tone="info" />
        <StatTile
          label="Partner registrations"
          value={String(partnerReferred)}
          sublabel={awaitingReview > 0 ? `${awaitingReview} awaiting review` : "Credited on conversion"}
          tone={awaitingReview > 0 ? "warning" : "neutral"}
          href="/leads?source=partner&status=NEW"
        />
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
          <Select name="source" defaultValue={params.source ?? ""} className="w-52">
            <option value="">All sources</option>
            <option value="partner">Partner registrations</option>
          </Select>
          <Select name="status" defaultValue={params.status ?? ""} className="w-52">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        <LeadsTable
          leads={serialize(leads) as never}
          users={users}
          canWrite={can(_me, PERMISSIONS.LEAD_WRITE)}
        />
      </Card>
    </>
  );
}
