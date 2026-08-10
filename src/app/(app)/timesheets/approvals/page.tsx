import Link from "next/link";
import { getPendingApprovals } from "@/server/timesheets";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Button , Forbidden} from "@/components/ui";
import { serialize } from "@/lib/utils";
import { ApprovalClient, type PendingEntry } from "./approval-client";

export default async function TimeApprovalsPage() {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.TIME_APPROVE)) return <Forbidden what="timesheets" />;
  const entries = await getPendingApprovals();

  return (
    <>
      <PageHeader
        title="Time approvals"
        description="Approved hours become project cost and billable value, so this is the gate before anything reaches an invoice."
      >
        <Button asChild variant="outline">
          <Link href="/timesheets">My timesheet</Link>
        </Button>
      </PageHeader>

      <ApprovalClient entries={serialize(entries) as unknown as PendingEntry[]} />
    </>
  );
}
