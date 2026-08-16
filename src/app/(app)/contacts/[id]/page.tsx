import Link from "next/link";
import { notFound } from "next/navigation";
import { Mail, Phone, MessageCircle, Star } from "lucide-react";
import { getContact } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, Button,
  DetailRow, Forbidden,
} from "@/components/ui";
import { humanize } from "@/lib/utils";

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ACCOUNT_READ)) return <Forbidden what="contacts" />;

  const { id } = await params;
  const contact = await getContact(id);
  if (!contact) notFound();

  const name = `${contact.firstName} ${contact.lastName}`;
  const address = contact.mailingAddress as Record<string, string> | null;

  return (
    <>
      <PageHeader title={name} description={contact.jobTitle ?? "No job title recorded"}>
        {contact.isPrimary && (
          <Badge tone="info">
            <Star className="h-3 w-3" /> Primary
          </Badge>
        )}
        <Badge tone={contact.active ? "success" : "neutral"}>
          {contact.active ? "Active" : "Inactive"}
        </Badge>
        {can(me, PERMISSIONS.ACCOUNT_WRITE) && (
          <Button asChild variant="outline">
            <Link href={`/contacts/${contact.id}/edit`}>Edit</Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>How to reach them</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Email">
              {contact.email ? (
                <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                  <Mail className="h-3.5 w-3.5" /> {contact.email}
                </a>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Phone">
              {contact.phone ? (
                <a href={`tel:${contact.phone}`} className="inline-flex items-center gap-1.5 hover:underline">
                  <Phone className="h-3.5 w-3.5" /> {contact.phone}
                </a>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Mobile">{contact.mobile ?? "—"}</DetailRow>
            <DetailRow label="WhatsApp">
              {contact.whatsapp ? (
                <span className="inline-flex items-center gap-1.5">
                  <MessageCircle className="h-3.5 w-3.5" /> {contact.whatsapp}
                </span>
              ) : (
                "—"
              )}
            </DetailRow>
            <DetailRow label="Prefers">
              {contact.preferredChannel ? humanize(contact.preferredChannel) : "—"}
            </DetailRow>
            <DetailRow label="Consent">
              <Badge tone={contact.communicationConsent ? "success" : "warning"}>
                {contact.communicationConsent ? "Given" : "Not given"}
              </Badge>
            </DetailRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Where they work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Account">
              {contact.account ? (
                <Link href={`/accounts/${contact.account?.id}`} className="text-primary hover:underline">
                  {contact.account?.name}
                </Link>
              ) : (
                <span className="text-muted-foreground">Not linked to an account</span>
              )}
            </DetailRow>
            <DetailRow label="Job title">{contact.jobTitle ?? "—"}</DetailRow>
            <DetailRow label="Department">{contact.department ?? "—"}</DetailRow>
            <DetailRow label="Role on account">{contact.contactRole ?? "—"}</DetailRow>
            {contact.partnerAsPerson && (
              <DetailRow label="Partner record">
                <Link
                  href={`/partners/${contact.partnerAsPerson?.id}`}
                  className="text-primary hover:underline"
                >
                  {contact.partnerAsPerson?.partnerNumber}
                </Link>
              </DetailRow>
            )}
            {address && (
              <DetailRow label="Address">
                <span className="whitespace-pre-line">
                  {[address.line1, address.city, address.state, address.country, address.postalCode]
                    .filter(Boolean)
                    .join("\n")}
                </span>
              </DetailRow>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
