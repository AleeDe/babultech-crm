import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { PageHeader, Forbidden, Alert } from "@/components/ui";
import { EmailLeadsForm } from "./email-form";

/**
 * Compose an email to the leads chosen on the list.
 *
 * The selection arrives in the URL rather than in a store, so the page can be
 * reloaded, and so a half-written email is never sitting behind a back button
 * with no idea who it was for.
 *
 * Who is suppressed is resolved HERE, before anything is typed. Finding out
 * afterwards that half the audience was unmailable is a wasted email and a
 * misleading scorecard.
 */
export default async function EmailLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_WRITE)) return <Forbidden what="leads" />;

  const { ids } = await searchParams;
  const leadIds = (ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s));

  if (leadIds.length === 0) {
    return (
      <>
        <PageHeader backTo="/leads" backLabel="Back to leads" title="Email leads" />
        <Alert tone="warning">
          Nobody was selected. Go back to the leads list, tick the people you want to email,
          and choose Email.
        </Alert>
      </>
    );
  }

  const db = await supabaseServer();

  const { data: leads } = await db
    .from("lead")
    .select("id, firstName, lastName, companyName, email, status")
    .in("id", leadIds)
    .is("deletedAt", null)
    .order("firstName");

  const rows = leads ?? [];

  const addresses = rows
    .map((l) => l.email?.toLowerCase().trim())
    .filter((e): e is string => Boolean(e));

  const { data: suppressed } = await db
    .from("email_suppression")
    .select("email, reason")
    .in("email", addresses.length ? addresses : ["-"]);

  const suppression = new Map(
    (suppressed ?? []).map((s) => [s.email as string, s.reason as string]),
  );

  // The same address twice means the same human twice — which duplicate leads
  // produce routinely. Worked out here so the screen can say so, and so the
  // count somebody reads matches the count that will actually be sent.
  const seen = new Set<string>();

  const audience = rows.map((l) => {
    const email = l.email?.toLowerCase().trim() ?? null;
    let skip: string | null = null;

    if (!email) skip = "No email address";
    else if (suppression.has(email)) {
      const reason = suppression.get(email)!;
      skip =
        reason === "UNSUBSCRIBED" ? "Unsubscribed"
        : reason === "BOUNCED" ? "Address bounced"
        : "Reported spam";
    } else if (seen.has(email)) skip = "Duplicate of another selected lead";
    else seen.add(email);

    return {
      id: l.id as string,
      name: `${l.firstName} ${l.lastName ?? ""}`.trim(),
      companyName: (l.companyName as string) ?? null,
      email: (l.email as string) ?? null,
      skip,
    };
  });

  return (
    <>
      <PageHeader
        backTo="/leads"
        backLabel="Back to leads"
        title="Email leads"
        description="Each person gets their own message, with their own unsubscribe link. Nothing is sent as a group."
      />
      <EmailLeadsForm
        audience={audience}
        defaultFromName={me.fullName}
        defaultReplyTo={me.email ?? ""}
      />
    </>
  );
}
