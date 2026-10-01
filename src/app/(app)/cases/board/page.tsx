import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getCaseBoard, moveCase } from "@/server/boards";
import { PageHeader, Forbidden, Button } from "@/components/ui";
import { Board } from "@/components/board";

const COLUMNS = [
  { key: "NEW", label: "New" },
  { key: "ASSIGNED", label: "Assigned" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "REOPENED", label: "Reopened" },
  { key: "WAITING_FOR_CUSTOMER", label: "Waiting for customer" },
  { key: "WAITING_FOR_INTERNAL_TEAM", label: "Waiting for our team" },
  { key: "WAITING_FOR_THIRD_PARTY", label: "Waiting for third party" },
  { key: "RESOLVED", label: "Resolved", ask: "What fixed it? This is recorded as the resolution." },
];

export default async function CaseBoardPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.CASE_READ)) return <Forbidden what="support cases" />;
  const cards = await getCaseBoard();
  return (
    <>
      <PageHeader title="Case board" description="Open cases by status. Closing a case happens on the case itself.">
        <Button asChild variant="outline"><Link href="/cases">List</Link></Button>
      </PageHeader>
      <Board columns={COLUMNS} cards={cards} move={moveCase} canMove={can(me, PERMISSIONS.CASE_WRITE)} />
    </>
  );
}
