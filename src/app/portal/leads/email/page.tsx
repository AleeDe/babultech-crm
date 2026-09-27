import { getPartnerProfile } from "@/server/portal";
import { listPartnerLeads } from "@/server/partner-leads";
import { PageHeader, Alert } from "@/components/ui";
import { PartnerEmailForm } from "./email-form";

/**
 * Email some of the partner's own leads.
 *
 * Only ids that are the partner's own come back from the lead list - which is
 * read under their session - so an id that is not theirs is simply not here.
 */
export default async function PortalLeadEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  const wanted = new Set((ids ?? "").split(",").filter(Boolean));
  const [leads, profile] = await Promise.all([listPartnerLeads(), getPartnerProfile()]);
  const chosen = leads.filter((l) => wanted.has(l.id) && !l.convertedAt);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        backTo="/portal/leads"
        backLabel="Back to leads"
        title="Email leads"
        description="Sent from BabulTech under your name, with replies coming to you. Everyone who has unsubscribed or whose mail bounced is left out."
      />
      {chosen.length === 0 ? (
        <Alert tone="info">Choose the leads to email from your lead list first.</Alert>
      ) : (
        <PartnerEmailForm
          leads={chosen.map((l) => ({ id: l.id, name: `${l.firstName} ${l.lastName}`, email: l.email }))}
          senderName={profile?.displayName ?? "Your company"}
          replyTo={profile?.email ?? null}
        />
      )}
    </div>
  );
}
