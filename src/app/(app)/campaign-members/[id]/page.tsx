import { notFound } from "next/navigation";
import { getCampaignMember } from "@/server/campaign-members";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Badge, Alert } from "@/components/ui";
import { formatDate, formatDateTime, humanize } from "@/lib/utils";
import { CampaignMemberForm } from "../member-form";
import { MemberActions } from "./member-actions";

/**
 * One member, shown as the form that edits them.
 *
 * A separate read-only view would be a second thing to keep in step for a
 * record that is almost all editable fields. What does not belong on the form
 * sits above it: when a campaign last reached them, and whether they have
 * unsubscribed — both facts about them rather than fields anyone types.
 */
export default async function CampaignMemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="campaign members" />;

  const { id } = await params;
  const member = await getCampaignMember(id);
  if (!member) notFound();

  const canWrite = can(me, PERMISSIONS.LEAD_WRITE);

  return (
    <>
      <PageHeader
        backTo="/campaign-members"
        backLabel="Back to members"
        title={`${member.firstName} ${member.lastName ?? ""}`.trim()}
        description={member.companyName ?? "No company recorded"}
      >
        {member.businessType && <Badge tone="neutral">{humanize(member.businessType)}</Badge>}
        {member.companySize && <Badge tone="neutral">{humanize(member.companySize)}</Badge>}
        {!member.active && <Badge tone="warning">Off the active list</Badge>}
      </PageHeader>

      {member.emailOptOut && (
        <div className="mb-5">
          <Alert tone="warning">
            <span className="font-medium">This person has unsubscribed.</span> They are left out of
            every email campaign, and will stay out until they ask to come back.
          </Alert>
        </div>
      )}

      {member.emailBounced && (
        <div className="mb-5">
          <Alert tone="danger">
            <span className="font-medium">Mail to this address bounced.</span> Sending to it again
            damages our sending reputation, so campaigns skip it until the address is corrected.
          </Alert>
        </div>
      )}

      <div className="mb-5 grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Last contacted</p>
          <p className="mt-0.5 font-medium">
            {member.lastCampaignRunAt ? formatDateTime(member.lastCampaignRunAt) : "Never"}
          </p>
          {member.lastCampaign?.name && (
            <p className="text-xs text-muted-foreground">{member.lastCampaign.name}</p>
          )}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Campaigns</p>
          <p className="mt-0.5 font-medium tabular">{member.campaignCount}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Added</p>
          <p className="mt-0.5 font-medium">{formatDate(member.createdAt)}</p>
          {member.source && <p className="text-xs text-muted-foreground">{member.source}</p>}
        </div>
      </div>

      {canWrite && (
        <div className="mb-5">
          <MemberActions
            id={member.id}
            name={`${member.firstName} ${member.lastName ?? ""}`.trim()}
            optedOut={member.emailOptOut}
          />
        </div>
      )}

      {canWrite ? (
        <CampaignMemberForm defaults={member} />
      ) : (
        <Alert tone="info">You can see this member but not change them.</Alert>
      )}
    </>
  );
}
