import Link from "next/link";
import { GitMerge } from "lucide-react";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { findDuplicateLeads } from "@/server/lead-merge";
import {
  PageHeader, Forbidden, Alert, Badge, Button, Card, CardHeader, CardTitle,
  CardContent, Table, THead, TBody, TR, TH, TD, EmptyState, StatTile,
} from "@/components/ui";
import { formatDate, humanize } from "@/lib/utils";

/**
 * Leads that look like the same person.
 *
 * Duplicates here are expected rather than a fault. A campaign member belongs to
 * the campaign that produced them, so somebody who came to a webinar and then a
 * trade show is two members and two leads - and that is worth keeping, because
 * both campaigns really did reach them.
 *
 * This is where it gets tidied up, by the only person who can actually tell:
 * whoever is working the leads.
 */
export default async function DuplicateLeadsPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="leads" />;

  const groups = await findDuplicateLeads();
  const canWrite = can(me, PERMISSIONS.LEAD_WRITE);
  const totalLeads = groups.reduce((sum, g) => sum + g.leads.length, 0);

  return (
    <>
      <PageHeader
        backTo="/leads"
        backLabel="Back to leads"
        title="Possible duplicates"
        description="Leads sharing an email address or a phone number. Matched on the last nine digits, so a country code does not hide a match."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatTile
          label="Groups to look at"
          value={String(groups.length)}
          tone={groups.length > 0 ? "warning" : "success"}
        />
        <StatTile label="Leads involved" value={String(totalLeads)} />
      </div>

      {groups.length === 0 ? (
        <Card className="mt-6">
          <div className="py-10">
            <EmptyState
              title="No duplicates found"
              description="No two live leads share an email address or a phone number."
            />
          </div>
        </Card>
      ) : (
        <>
          <div className="mt-6">
            <Alert tone="info">
              <span className="font-medium">Merging keeps everything.</span> Notes, emails, logged
              calls and the campaign members behind each lead all move to the record you keep, so
              every campaign stays credited. The others are retired rather than deleted.
            </Alert>
          </div>

          <div className="mt-6 space-y-5">
            {groups.map((group) => (
              <Card key={group.leads.map((l) => l.id).join("-")}>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>{group.leads.length} leads share {group.matchedOn}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Oldest first. The most complete record is suggested as the one to keep.
                    </p>
                  </div>
                  {canWrite && (
                    <Button asChild>
                      <Link
                        href={`/leads/merge?ids=${group.leads.map((l) => l.id).join(",")}`}
                      >
                        <GitMerge className="h-4 w-4" /> Merge these
                      </Link>
                    </Button>
                  )}
                </CardHeader>
                <CardContent className="px-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Lead</TH>
                        <TH priority="secondary">Company</TH>
                        <TH>Email</TH>
                        <TH priority="secondary">Phone</TH>
                        <TH priority="tertiary">Source</TH>
                        <TH>Created</TH>
                        <TH className="text-right">Fields filled</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {group.leads.map((lead) => (
                        <TR key={lead.id}>
                          <TD>
                            <Link
                              href={`/leads/${lead.id}`}
                              className="text-sm font-medium hover:underline"
                            >
                              {lead.firstName} {lead.lastName}
                            </Link>
                            <p className="text-xs text-muted-foreground">
                              {lead.leadNumber} · {humanize(lead.status)}
                            </p>
                          </TD>
                          <TD className="text-sm" priority="secondary">
                            {lead.companyName ?? "—"}
                          </TD>
                          <TD className="text-sm">{lead.email ?? "—"}</TD>
                          <TD className="text-sm" priority="secondary">{lead.phone ?? "—"}</TD>
                          <TD className="text-sm" priority="tertiary">
                            {lead.leadSource ? humanize(lead.leadSource) : "—"}
                          </TD>
                          <TD className="text-sm">{formatDate(lead.createdAt)}</TD>
                          <TD className="text-right">
                            <Badge tone="neutral">{lead.completeness}</Badge>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
