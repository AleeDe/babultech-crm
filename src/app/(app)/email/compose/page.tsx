import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getAudience, listTemplates, listSenders } from "@/server/communications";
import { listContacts } from "@/server/crm";
import { listCampaignMembers } from "@/server/campaign-members";
import { PageHeader, Forbidden, Alert, Button } from "@/components/ui";
import { ComposeForm } from "./compose-form";

type Audience = "Lead" | "Contact" | "CampaignMember";

const BACK: Record<Audience, { href: string; label: string; noun: string }> = {
  Lead: { href: "/leads", label: "Back to leads", noun: "leads" },
  Contact: { href: "/contacts", label: "Back to contacts", noun: "contacts" },
  CampaignMember: { href: "/campaign-members", label: "Back to campaign members", noun: "campaign members" },
};

/**
 * Compose one email to leads, contacts or campaign members. The people arrive
 * in the address - chosen on a list, or one person from their page - so the
 * page can be reloaded and a half-written email is never sent to a stale list.
 */
export default async function ComposePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  const params = await searchParams;
  const type = (["Lead", "Contact", "CampaignMember"].includes(params.type ?? "") ? params.type : "Lead") as Audience;
  const allowed = type === "Contact" ? can(me, PERMISSIONS.ACCOUNT_WRITE) : can(me, PERMISSIONS.LEAD_WRITE);
  if (!allowed) return <Forbidden what={`emailing ${BACK[type].noun}`} />;

  let ids = (params.ids ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s));
  // "Email these" on a list passes the list's filters rather than hundreds of
  // ids, and the same list is read again here, under the sender's own access.
  if (!ids.length && params.from === "contacts" && type === "Contact") {
    const list = await listContacts({ search: params.search, unaffiliatedOnly: params.filter === "unaffiliated" });
    ids = (list as { id: string }[]).map((c) => c.id);
  }
  if (!ids.length && params.from === "campaign-members" && type === "CampaignMember") {
    const list = await listCampaignMembers(params as never);
    ids = list.map((m) => m.id as string);
  }
  if (ids.length === 0) {
    return (
      <>
        <PageHeader backTo={BACK[type].href} backLabel={BACK[type].label} title={`Email ${BACK[type].noun}`} />
        <Alert tone="warning">Nobody was chosen. Go back to the list, tick the people you want to email, and choose Email.</Alert>
      </>
    );
  }

  // Contacts default to only those who agreed to marketing.
  const consentedOnly = type === "Contact" && params.consent !== "0";
  const [audience, templates, { senders }] = await Promise.all([
    getAudience(type, ids, consentedOnly),
    listTemplates(type),
    listSenders(),
  ]);
  const consentHref = type === "Contact"
    ? `/email/compose?${new URLSearchParams({ ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined)) as Record<string, string>, consent: consentedOnly ? "0" : "1" })}`
    : null;

  return (
    <>
      <PageHeader
        backTo={BACK[type].href}
        backLabel={BACK[type].label}
        title={`Email ${ids.length === 1 && audience[0] ? audience[0].name : BACK[type].noun}`}
        description="Each person gets their own message, with their own unsubscribe link. Nothing is sent as a group."
      >
        <Button asChild variant="outline"><Link href="/email/templates">Email templates</Link></Button>
      </PageHeader>
      <ComposeForm
        audienceType={type}
        audience={audience}
        templates={templates}
        senders={senders}
        defaultReplyTo={me.email ?? ""}
        consentedOnly={consentedOnly}
        consentHref={consentHref}
      />
    </>
  );
}
