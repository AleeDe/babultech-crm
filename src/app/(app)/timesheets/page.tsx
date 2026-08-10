import Link from "next/link";
import { getMyWeek, getTimeEntryOptions, startOfWeek } from "@/server/timesheets";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Button } from "@/components/ui";
import { serialize } from "@/lib/utils";
import { TimesheetClient, type Entry, type EntryOptions } from "./timesheet-client";

export default async function TimesheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireUser();
  const { week } = await searchParams;

  const weekStart = await startOfWeek(week ? new Date(week) : new Date());
  const weekStartISO = weekStart.toISOString().slice(0, 10);

  const [{ entries }, options] = await Promise.all([
    getMyWeek(weekStartISO),
    getTimeEntryOptions(),
  ]);

  return (
    <>
      <PageHeader
        title="My timesheet"
        description="Book time against a project task or a support case, then submit the week for approval. Approved time is locked."
      >
        {can(user, PERMISSIONS.TIME_APPROVE) && (
          <Button asChild variant="outline">
            <Link href="/timesheets/approvals">Approvals</Link>
          </Button>
        )}
      </PageHeader>

      <TimesheetClient
        weekStart={weekStartISO}
        entries={serialize(entries) as unknown as Entry[]}
        options={serialize(options) as unknown as EntryOptions}
      />
    </>
  );
}
