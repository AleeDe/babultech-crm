import Link from "next/link";
import { notFound } from "next/navigation";
import { listNotes } from "@/server/notes";
import { listDocuments } from "@/server/documents";
import { NotesPanel } from "@/components/notes-panel";
import { AuditPanel } from "@/components/audit-panel";
import { getAuditTrail } from "@/lib/audit";
import { DocumentsPanel } from "@/components/documents-panel";
import { Mail, Phone, MessageCircle, ArrowRight } from "lucide-react";
import { getLead } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, statusTone,
  Button, DetailRow, Alert, Forbidden, StatTile,
} from "@/components/ui";
import { formatMoney, formatDate, formatDateTime, humanize } from "@/lib/utils";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `campaign` is set when arriving from a campaign's lead list. */
  searchParams: Promise<{ campaign?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="leads" />;

  const [{ id }, query] = await Promise.all([params, searchParams]);

  const [notes, documents, audit] = await Promise.all([
    listNotes("Lead", id),
    listDocuments("Lead", id),
    getAuditTrail("Lead", id, 15),
  ]);
  const lead = await getLead(id);
  if (!lead) notFound();

  const name = `${lead.firstName} ${lead.lastName}`;
  const converted = Boolean(lead.convertedAt);
  const disqualified = lead.status === "DISQUALIFIED";

  /**
   * Which campaign a touch logged from here should be attributed to.
   *
   * The `campaign` query parameter wins because it says which campaign the
   * user was actually working in — a lead can be attributed to one campaign
   * while being worked as part of another. Its own campaign is the fallback so
   * the field is still prefilled when the lead is reached directly.
   */
  const attributedCampaignId = query.campaign ?? lead.campaign?.id ?? "";

  const logTouchHref = `/activities/new?${new URLSearchParams({
    relatedEntityType: "Lead",
    relatedEntityId: lead.id,
    activityType: "MESSAGE_SENT",
    subject: `Outreach to ${name}`,
    ...(attributedCampaignId ? { campaignId: String(attributedCampaignId) } : {}),
  })}`;

  return (
    <>
      <PageHeader title={name} description={lead.companyName ?? lead.leadNumber}>
        <Badge tone={statusTone(lead.status)}>{humanize(lead.status)}</Badge>
        {lead.rating && <Badge tone={statusTone(lead.rating)}>{humanize(lead.rating)}</Badge>}
        {!converted && (
          <Button asChild variant="outline">
            <Link href={logTouchHref}>Log a touch</Link>
          </Button>
        )}
        {can(me, PERMISSIONS.LEAD_WRITE) && !converted && (
          <Button asChild variant="outline">
            <Link href={`/leads/${lead.id}/edit`}>Edit</Link>
          </Button>
        )}
      </PageHeader>

      {converted && (
        <div className="mb-5">
          <Alert tone="success">
            <p className="font-medium">Converted on {formatDate(lead.convertedAt)}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {lead.convertedAccount && (
                <Link href={`/accounts/${lead.convertedAccount?.id}`} className="inline-flex items-center gap-1 underline">
                  {lead.convertedAccount?.name} <ArrowRight className="h-3 w-3" />
                </Link>
              )}
              {lead.convertedOpportunity && (
                <Link href={`/opportunities/${lead.convertedOpportunity?.id}`} className="inline-flex items-center gap-1 underline">
                  {lead.convertedOpportunity?.name} <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </p>
          </Alert>
        </div>
      )}

      {disqualified && lead.disqualifiedReason && (
        <div className="mb-5">
          <Alert tone="warning">
            <p className="font-medium">Disqualified</p>
            <p className="mt-0.5 text-sm">{lead.disqualifiedReason}</p>
          </Alert>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Estimated value" value={formatMoney(lead.estimatedValue)} />
        <StatTile label="Source" value={lead.leadSource ?? "—"} sublabel={lead.industry ?? undefined} />
        <StatTile label="Owner" value={lead.owner?.fullName ?? "—"} />
        <StatTile
          label="Next follow-up"
          value={lead.nextFollowUpAt ? formatDate(lead.nextFollowUpAt) : "None set"}
          tone={lead.nextFollowUpAt ? "neutral" : "warning"}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>How to reach them</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Email">
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <Mail className="h-3.5 w-3.5" /> {lead.email}
                </a>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Phone">
              {lead.phone ? (
                <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1.5 hover:underline">
                  <Phone className="h-3.5 w-3.5" /> {lead.phone}
                </a>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="WhatsApp">
              {lead.whatsapp ? (
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="h-3.5 w-3.5" /> {lead.whatsapp}
                </span>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Job title">{lead.jobTitle ?? "—"}</DetailRow>
            <DetailRow label="Company">{lead.companyName ?? "—"}</DetailRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where it came from</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Lead number">{lead.leadNumber}</DetailRow>
            <DetailRow label="Source">{lead.leadSource ?? "—"}</DetailRow>
            <DetailRow label="Campaign">
              {lead.campaign ? (
                <Link href={`/campaigns/${lead.campaign?.id}`} className="text-primary hover:underline">
                  {lead.campaign?.name}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Referred by">
              {lead.referredByPartner ? (
                <Link href={`/partners/${lead.referredByPartner?.id}`} className="text-primary hover:underline">
                  {lead.referredByPartner?.displayName}
                </Link>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Created">{formatDateTime(lead.createdAt)}</DetailRow>
          </CardContent>
        </Card>
      </div>

      {lead.description && (
        <Card className="mt-6">
          <CardHeader>
            {/* The lead's own description field, distinct from the Notes panel
                below where anyone can add to the record over time. */}
            <CardTitle>Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{lead.description}</p>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <NotesPanel entityType="Lead" entityId={id} notes={notes} />
        <DocumentsPanel entityType="Lead" entityId={id} documents={documents} />
      </div>

      <div className="mt-6">
        <AuditPanel entries={audit as never} />
      </div>
    </>
  );
}
