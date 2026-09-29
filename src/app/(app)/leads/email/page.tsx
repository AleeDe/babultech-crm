import { redirect } from "next/navigation";

/**
 * Emailing leads moved to the one compose screen shared with contacts and
 * campaign members. Kept so older links and bookmarks still arrive there.
 */
export default async function EmailLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const { ids } = await searchParams;
  redirect(`/email/compose?${new URLSearchParams({ type: "Lead", ids: ids ?? "" })}`);
}
