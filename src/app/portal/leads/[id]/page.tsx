import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Mail, Pencil, Repeat } from "lucide-react";
import { getPartnerLead, listPartnerActivities } from "@/server/partner-leads";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Button, DetailRow, Alert, statusTone,
} from "@/components/ui";
import { formatDate, formatDateTime, formatMoney, humanize } from "@/lib/utils";
import { PartnerActivityPanel } from "../../activity-panel";

/** One of the partner's leads: who they are, and everything done with them. */
export default async function PortalLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lead, activities] = await Promise.all([getPartnerLead(id), listPartnerActivities("Lead", id)]);
  if (!lead) notFound();

  const converted = Boolean(lead.convertedAt);
  const address = [lead.street, lead.city, lead.state, lead.postalCode, lead.country].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader
        backTo="/portal/leads"
        backLabel="Back to leads"
        title={`${lead.firstName} ${lead.lastName}`}
        description={[lead.jobTitle, lead.companyName].filter(Boolean).join(" at ") || lead.leadNumber}
      >
        <Badge tone={statusTone(lead.status)}>{humanize(lead.status)}</Badge>
        {!converted && (
          <>
            {lead.email && (
              <Button asChild variant="outline">
                <Link href={`/portal/leads/email?ids=${lead.id}`}>
                  <Mail className="h-4 w-4" /> Email
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={`/portal/leads/${lead.id}/edit`}>
                <Pencil className="h-4 w-4" /> Edit
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/portal/leads/${lead.id}/convert`}>
                <Repeat className="h-4 w-4" /> Convert
              </Link>
            </Button>
          </>
        )}
      </PageHeader>

      {converted && (
        <div className="mb-5">
          <Alert tone="success">
            <span className="font-medium">Converted {formatDate(lead.convertedAt)}.</span>{" "}
            {lead.convertedAccountId && (
              <Link href={`/portal/customers/${lead.convertedAccountId}`} className="font-medium underline">
                Open the account <ArrowRight className="inline h-3.5 w-3.5" />
              </Link>
            )}
          </Alert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <PartnerActivityPanel entityType="Lead" entityId={lead.id} activities={activities} canLog={!converted} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Lead number">{lead.leadNumber}</DetailRow>
            <DetailRow label="Email">{lead.email ?? "—"}</DetailRow>
            <DetailRow label="Phone">{lead.phone ?? "—"}</DetailRow>
            <DetailRow label="WhatsApp">{lead.whatsapp ?? "—"}</DetailRow>
            <DetailRow label="Website">{lead.website ?? "—"}</DetailRow>
            <DetailRow label="Industry">{lead.industry ? humanize(lead.industry) : "—"}</DetailRow>
            <DetailRow label="Address">{address || "—"}</DetailRow>
            <DetailRow label="Rating">{lead.rating ? humanize(lead.rating) : "—"}</DetailRow>
            <DetailRow label="Estimated value">
              {lead.estimatedValue != null ? formatMoney(lead.estimatedValue, "PKR") : "—"}
            </DetailRow>
            <DetailRow label="Next follow-up">
              {lead.nextFollowUpAt && !converted ? formatDateTime(lead.nextFollowUpAt) : "—"}
            </DetailRow>
            {lead.disqualifiedReason && <DetailRow label="Why disqualified">{lead.disqualifiedReason}</DetailRow>}
            {lead.description && (
              <DetailRow label="Notes"><p className="whitespace-pre-wrap">{lead.description}</p></DetailRow>
            )}
            <DetailRow label="Added">{formatDate(lead.createdAt)}</DetailRow>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
