import { getPortalContext } from "@/server/portal";
import { getPartnerThread } from "@/server/partner-activities";
import { DEFAULT_PARTNER_EMAIL_TO } from "@/lib/partner-policy";
import { PageHeader } from "@/components/ui";
import { PartnerThread } from "@/components/partner-thread";
import { serialize } from "@/lib/utils";

/**
 * The partner's side of the conversation.
 *
 * Reached from the Contact button on the overview as well as the menu, because
 * "I need to ask someone something" is the reason a partner opens the portal
 * at all, and it should not be a hunt through a menu.
 */
export default async function PortalActivitiesPage() {
  const [ctx, messages] = await Promise.all([getPortalContext(), getPartnerThread()]);

  return (
    <>
      <PageHeader
        title="Activities"
        description="Everything said between you and us — messages, email and files — kept in one place."
      />
      <PartnerThread
        partnerId={ctx?.partnerId ?? ""}
        messages={serialize(messages) as never}
        side="PARTNER"
        otherPartyName="BabulTech"
        defaultEmailTo={DEFAULT_PARTNER_EMAIL_TO}
      />
    </>
  );
}
