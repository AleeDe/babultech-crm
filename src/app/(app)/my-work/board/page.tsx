import Link from "next/link";
import { getTaskBoard, moveTask } from "@/server/boards";
import { PageHeader, Button } from "@/components/ui";
import { Board } from "@/components/board";

const COLUMNS = [
  { key: "NOT_STARTED", label: "Not started" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "BLOCKED", label: "Blocked" },
  { key: "UNDER_REVIEW", label: "Under review" },
  { key: "COMPLETED", label: "Completed" },
];

export default async function TaskBoardPage() {
  const cards = await getTaskBoard();
  return (
    <>
      <PageHeader title="My task board" description="Project tasks assigned to you, by status. Completing one sets it to 100%.">
        <Button asChild variant="outline"><Link href="/my-work">My work</Link></Button>
      </PageHeader>
      <Board columns={COLUMNS} cards={cards} move={moveTask} canMove />
    </>
  );
}
