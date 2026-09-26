import Link from "next/link";
import { BanIcon, MailX, Plus, Upload } from "lucide-react";
import { listCampaignMembers, getCampaignMemberTotals } from "@/server/campaign-members";
import { getPicklistMap } from "@/server/picklists";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, Button, Select,
  EmptyState, StatTile, Input, Forbidden,
} from "@/components/ui";
import { formatDate, humanize } from "@/lib/utils";

/**
 * The marketing list: people we talk to who are not leads yet.
 *
 * "Last contacted" is the column that earns its place. Building an audience
 * without it is how somebody gets mailed three weeks running, and the quickest
 * way to have a list unsubscribe itself.
 */
export default async function CampaignMembersPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string; businessType?: string; companySize?: string;
    campaignId?: string; source?: string; converted?: string;
  }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="campaign members" />;

  const params = await searchParams;
  const [members, totals, picklists] = await Promise.all([
    listCampaignMembers(params),
    getCampaignMemberTotals(),
    getPicklistMap().catch(() => ({})),
  ]);

  const lists = picklists as Record<string, { value: string; label: string }[]>;
  const canWrite = can(me, PERMISSIONS.LEAD_WRITE);

  return (
    <>
      <PageHeader
        title="Campaign members"
        description="People marketing talks to. A member exists once here, however many campaigns they take part in."
      >
        {canWrite && (
          <>
            <Button asChild variant="secondary">
              <Link href="/campaign-members/import">
                <Upload className="h-4 w-4" /> Import a list
              </Link>
            </Button>
            <Button asChild>
              <Link href="/campaign-members/new">
                <Plus className="h-4 w-4" /> New member
              </Link>
            </Button>
          </>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Members" value={String(totals.total)} />
        <StatTile
          label="Can be emailed"
          value={String(totals.contactable)}
          sublabel="Has an address, not opted out"
          tone="success"
        />
        <StatTile
          label="Never contacted"
          value={String(totals.neverContacted)}
          tone={totals.neverContacted ? "info" : "neutral"}
        />
        <StatTile
          label="Unsubscribed"
          value={String(totals.optedOut)}
          tone={totals.optedOut ? "warning" : "neutral"}
        />
      </div>

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-[14rem] flex-1">
            <Input
              name="search"
              placeholder="Name, company or email…"
              defaultValue={params.search ?? ""}
              aria-label="Search members"
            />
          </div>
          <Select name="businessType" defaultValue={params.businessType ?? ""} aria-label="Business type">
            <option value="">Any business type</option>
            {(lists.business_type ?? []).map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </Select>
          <Select name="companySize" defaultValue={params.companySize ?? ""} aria-label="Company size">
            <option value="">Any size</option>
            {(lists.company_size ?? []).map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </Select>
          <Select name="source" defaultValue={params.source ?? ""} aria-label="How we got them">
            <option value="">Any source</option>
            {(lists.member_source ?? []).map((v) => (
              <option key={v.value} value={v.value}>{v.label}</option>
            ))}
          </Select>
          {/* The one filter an agent uses every day: who is still to be worked. */}
          <Select name="converted" defaultValue={params.converted ?? ""} aria-label="Converted">
            <option value="">Converted or not</option>
            <option value="no">Not yet a lead</option>
            <option value="yes">Already a lead</option>
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {members.length === 0 ? (
          <div className="py-10">
            <EmptyState
              title="Nobody on the list yet"
              description="Import a list, or add people one at a time. They stay here until they become a lead."
              action={
                canWrite ? (
                  <Button asChild>
                    <Link href="/campaign-members/import">
                      <Upload className="h-4 w-4" /> Import a list
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Company</TH>
                <TH priority="secondary">Campaign</TH>
                <TH priority="secondary">Business type</TH>
                <TH priority="tertiary">Size</TH>
                <TH priority="secondary">Last contacted</TH>
                <TH className="text-right" priority="tertiary">Campaigns</TH>
                <TH>Email</TH>
              </TR>
            </THead>
            <TBody>
              {members.map((member) => (
                <TR key={member.id}>
                  <TD>
                    <Link
                      href={`/campaign-members/${member.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {member.firstName} {member.lastName ?? ""}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {member.email ?? member.phone ?? "No contact details"}
                    </p>
                  </TD>
                  <TD className="text-sm">
                    {member.companyName ?? "—"}
                    {member.city && (
                      <p className="text-xs text-muted-foreground">{member.city}</p>
                    )}
                  </TD>
                  <TD className="text-sm" priority="secondary">
                    {member.campaign?.name ?? "—"}
                    {member.source && (
                      <p className="text-xs text-muted-foreground">{humanize(member.source)}</p>
                    )}
                  </TD>
                  <TD className="text-sm">
                    {member.businessType ? humanize(member.businessType) : "—"}
                  </TD>
                  <TD className="text-sm">
                    {member.companySize ? humanize(member.companySize) : "—"}
                  </TD>
                  <TD className="whitespace-nowrap text-sm">
                    {member.lastCampaignRunAt ? (
                      <>
                        {formatDate(member.lastCampaignRunAt)}
                        {member.lastCampaign?.name && (
                          <p className="text-xs text-muted-foreground">{member.lastCampaign.name}</p>
                        )}
                      </>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TD>
                  <TD className="text-right tabular">{member.campaignCount}</TD>
                  <TD>
                    {member.emailOptOut ? (
                      <Badge tone="warning">
                        <MailX className="mr-1 inline h-3 w-3" />
                        Unsubscribed
                      </Badge>
                    ) : member.emailBounced ? (
                      <Badge tone="danger">
                        <BanIcon className="mr-1 inline h-3 w-3" />
                        Bounced
                      </Badge>
                    ) : member.email ? (
                      <Badge tone="success">Contactable</Badge>
                    ) : (
                      <Badge tone="neutral">No address</Badge>
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
