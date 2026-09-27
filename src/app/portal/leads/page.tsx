import Link from "next/link";
import { Plus, Upload } from "lucide-react";
import { listPartnerLeads } from "@/server/partner-leads";
import { PageHeader, Card, Button, EmptyState, StatTile } from "@/components/ui";
import { ListFilters } from "@/components/list-filters";
import { humanize } from "@/lib/utils";
import { PartnerLeadsTable } from "./leads-table";

const STATUSES = [
  "NEW", "ASSIGNED", "ATTEMPTED_CONTACT", "CONTACTED", "DISCOVERY_SCHEDULED",
  "QUALIFIED", "NURTURING", "DISQUALIFIED", "CONVERTED",
];

/**
 * The partner's own leads: the people they are working towards a sale.
 *
 * Laid out like our team's lead list, because a partner is doing the same job
 * on the same kind of record. Everybody at the partner company sees the same
 * list; nobody sees another partner's, or ours.
 */
export default async function PortalLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const [leads, all] = await Promise.all([
    listPartnerLeads({ search: params.search, status: params.status }),
    params.search || params.status ? listPartnerLeads() : null,
  ]);
  const everything = all ?? leads;

  const open = everything.filter((l) => !l.convertedAt && l.status !== "DISQUALIFIED");
  const now = Date.now();
  const due = open.filter((l) => l.nextFollowUpAt && new Date(l.nextFollowUpAt).getTime() <= now);
  const converted = everything.filter((l) => l.convertedAt);

  return (
    <>
      <PageHeader
        title="Leads"
        description="The people you are working towards a sale. Log what you do, follow up, and convert the good ones into an account and a deal."
      >
        <Button asChild variant="outline">
          <Link href="/portal/leads/import">
            <Upload className="h-4 w-4" /> Import
          </Link>
        </Button>
        <Button asChild>
          <Link href="/portal/leads/new">
            <Plus className="h-4 w-4" /> New lead
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Open leads" value={String(open.length)} />
        <StatTile label="Follow-ups due" value={String(due.length)} tone={due.length ? "warning" : "neutral"} />
        <StatTile label="Converted" value={String(converted.length)} tone="success" />
      </div>

      {everything.length > 0 && (
        <div className="mt-6">
          <ListFilters
            searchPlaceholder="Search name, company, email or phone…"
            searchValue={params.search}
            selects={[
              {
                name: "status",
                allLabel: "All statuses",
                value: params.status,
                className: "w-56",
                options: STATUSES.map((s) => ({ value: s, label: humanize(s) })),
              },
            ]}
          />
        </div>
      )}

      <Card className={everything.length > 0 ? undefined : "mt-6"}>
        {leads.length === 0 ? (
          <div className="py-10">
            <EmptyState
              title={everything.length === 0 ? "No leads yet" : "No leads match"}
              description={
                everything.length === 0
                  ? "Add the people you are talking to, or import a list. Anybody already in our records is left out, so nobody is contacted twice."
                  : "Nothing matches those filters. Clear them to see all your leads again."
              }
              action={
                everything.length === 0 ? (
                  <Button asChild>
                    <Link href="/portal/leads/new">
                      <Plus className="h-4 w-4" /> Add your first lead
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <PartnerLeadsTable leads={leads} />
        )}
      </Card>
    </>
  );
}
