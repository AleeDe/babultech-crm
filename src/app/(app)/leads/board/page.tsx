import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getLeadBoard, moveLead } from "@/server/boards";
import { PageHeader, Forbidden, Button } from "@/components/ui";
import { Board } from "@/components/board";

const COLUMNS = [
  { key: "PROSPECT", label: "Prospect" },
  { key: "NEW", label: "New" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "ATTEMPTED_CONTACT", label: "Attempted contact" },
  { key: "CONTACTED", label: "Contacted" },
  { key: "DISCOVERY_SCHEDULED", label: "Discovery scheduled" },
  { key: "QUALIFIED", label: "Qualified" },
  { key: "NURTURING", label: "Nurturing" },
];

export default async function LeadBoardPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="leads" />;
  const cards = await getLeadBoard();
  return (
    <>
      <PageHeader title="Lead board" description="Open leads by status. Drag a card, or use its Move to list. Converting and disqualifying happen on the lead itself.">
        <Button asChild variant="outline"><Link href="/leads">List</Link></Button>
      </PageHeader>
      <Board columns={COLUMNS} cards={cards} move={moveLead} canMove={can(me, PERMISSIONS.LEAD_WRITE)} showAmounts />
    </>
  );
}
