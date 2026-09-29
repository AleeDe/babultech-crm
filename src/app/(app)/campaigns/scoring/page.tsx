import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getScoring } from "@/server/lead-scoring";
import { PageHeader, Forbidden } from "@/components/ui";
import { ScoringEditor } from "./scoring-editor";

export default async function LeadScoringPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="lead scoring" />;
  const scoring = await getScoring();
  return (
    <>
      <PageHeader
        backTo="/campaigns"
        backLabel="Back to campaigns"
        title="Lead scoring"
        description="Points a lead earns from what it does and who it is. When a lead first reaches the threshold its owner is told, and a prospect can move to New by itself."
      />
      <ScoringEditor {...scoring} canEdit={can(me, PERMISSIONS.ADMIN)} />
    </>
  );
}
