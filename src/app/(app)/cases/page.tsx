import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requirePermission, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Select, Input, Button,
} from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/utils";

const OPEN_STATUSES = [
  "NEW", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CUSTOMER",
  "WAITING_FOR_INTERNAL_TEAM", "WAITING_FOR_THIRD_PARTY", "REOPENED",
];

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; priority?: string; search?: string }>;
}) {
  await requirePermission(PERMISSIONS.CASE_READ);
  const params = await searchParams;

  const cases = await prisma.case.findMany({
    where: {
      deletedAt: null,
      ...(params.status ? { status: params.status as never } : {}),
      ...(params.priority ? { priority: params.priority as never } : {}),
      ...(params.search
        ? {
            OR: [
              { subject: { contains: params.search, mode: "insensitive" as const } },
              { caseNumber: { contains: params.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    include: {
      account: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
      owner: { select: { fullName: true } },
      team: { select: { name: true } },
      slaPolicy: { select: { name: true } },
      category: { select: { name: true } },
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  const now = new Date();
  const open = cases.filter((c) => OPEN_STATUSES.includes(c.status));
  const breached = cases.filter(
    (c) => c.slaBreached || (c.resolutionDueAt && c.resolutionDueAt < now && !c.resolvedAt),
  );
  const unassigned = open.filter((c) => !c.ownerUserId && !c.teamId);
  const critical = open.filter((c) => c.priority === "CRITICAL");

  return (
    <>
      <PageHeader
        title="Support cases"
        description="Every case belongs to a customer and to one of that customer's contacts. SLA deadlines are set from the priority."
      >
        <Button asChild>
          <Link href="/cases/new">
            <Plus className="h-4 w-4" /> New case
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open cases" value={String(open.length)} />
        <StatTile label="Critical" value={String(critical.length)} tone={critical.length ? "danger" : "neutral"} />
        <StatTile label="SLA breached" value={String(breached.length)} tone={breached.length ? "danger" : "success"} />
        <StatTile label="Unassigned" value={String(unassigned.length)} tone={unassigned.length ? "warning" : "neutral"} />
      </div>

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-[220px] flex-1">
            <Input name="search" placeholder="Search subject or case number…" defaultValue={params.search} />
          </div>
          <Select name="priority" defaultValue={params.priority ?? ""} className="w-40">
            <option value="">All priorities</option>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => (
              <option key={p} value={p}>{humanize(p)}</option>
            ))}
          </Select>
          <Select name="status" defaultValue={params.status ?? ""} className="w-56">
            <option value="">All statuses</option>
            {[...OPEN_STATUSES, "RESOLVED", "CLOSED", "CANCELLED"].map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {cases.length === 0 ? (
          <EmptyState
            title="No cases yet"
            description="Cases arrive from email, the portal, phone or WhatsApp — or you can raise one here against a customer contact."
            action={
              <Button asChild>
                <Link href="/cases/new">Create the first case</Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Case</TH>
                <TH>Customer</TH>
                <TH>Category</TH>
                <TH>Assigned</TH>
                <TH>First response due</TH>
                <TH>Resolution due</TH>
                <TH>Priority</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {cases.map((c) => {
                const resolutionLate =
                  c.resolutionDueAt && c.resolutionDueAt < now && !c.resolvedAt;
                const responseLate =
                  c.firstResponseDueAt && c.firstResponseDueAt < now && !c.firstRespondedAt;

                return (
                  <TR key={c.id}>
                    <TD>
                      <Link href={`/cases/${c.id}`} className="font-medium hover:underline">
                        {c.subject}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {c.caseNumber} · {humanize(c.source)}
                      </p>
                    </TD>
                    <TD className="text-sm">
                      <Link href={`/accounts/${c.account.id}`} className="hover:underline">
                        {c.account.name}
                      </Link>
                      {c.contact && (
                        <Link
                          href={`/contacts/${c.contact.id}/edit`}
                          className="block text-xs text-muted-foreground hover:underline"
                        >
                          {c.contact.firstName} {c.contact.lastName}
                        </Link>
                      )}
                    </TD>
                    <TD className="text-sm text-muted-foreground">{c.category?.name ?? "—"}</TD>
                    <TD className="text-sm text-muted-foreground">
                      {c.owner?.fullName ?? c.team?.name ?? (
                        <span className="text-amber-600 dark:text-amber-400">Unassigned</span>
                      )}
                    </TD>
                    <TD className={`text-sm ${responseLate ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatDateTime(c.firstResponseDueAt)}
                    </TD>
                    <TD className={`text-sm ${resolutionLate ? "text-red-600 dark:text-red-400" : ""}`}>
                      {formatDateTime(c.resolutionDueAt)}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(c.priority)}>{humanize(c.priority)}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(c.status)}>{humanize(c.status)}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
