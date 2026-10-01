import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getDealBoard, moveDeal } from "@/server/boards";
import { PageHeader, Forbidden, Button } from "@/components/ui";
import { Board } from "@/components/board";

const COLUMNS = [
  { key: "DISCOVERY", label: "Discovery" },
  { key: "QUALIFICATION", label: "Qualification" },
  { key: "REQUIREMENTS", label: "Requirements" },
  { key: "SOLUTION_PROPOSED", label: "Solution proposed" },
  { key: "QUOTE_SUBMITTED", label: "Quote submitted" },
  { key: "NEGOTIATION", label: "Negotiation" },
  { key: "VERBAL_CONFIRMATION", label: "Verbal confirmation" },
  { key: "ON_HOLD", label: "On hold" },
  { key: "CLOSED_WON", label: "Won (last 30 days)" },
  { key: "CLOSED_LOST", label: "Lost (last 30 days)", ask: "Why was it lost?" },
];

export default async function DealBoardPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="deals" />;
  const cards = await getDealBoard();
  return (
    <>
      <PageHeader title="Deal board" description="The pipeline by stage. A deal is won only once it has its products and an accepted quote, as on its own page.">
        <Button asChild variant="outline"><Link href="/opportunities">List</Link></Button>
      </PageHeader>
      <Board columns={COLUMNS} cards={cards} move={moveDeal} canMove={can(me, PERMISSIONS.OPPORTUNITY_WRITE)} showAmounts />
    </>
  );
}
