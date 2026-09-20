import Link from "next/link";
import { Ticket } from "lucide-react";
import { listMyCases } from "@/server/support-portal";
import { PageHeader, Button, Badge, statusTone, Card, CardContent } from "@/components/ui";
import { formatDate, humanize } from "@/lib/utils";

const OPEN = ["NEW", "ASSIGNED", "IN_PROGRESS", "WAITING_FOR_CUSTOMER", "WAITING_FOR_INTERNAL_TEAM", "WAITING_FOR_THIRD_PARTY", "REOPENED"];

/** Everything this customer has raised, newest first. */
export default async function MyTicketsPage() {
  const cases = await listMyCases();
  const open = cases.filter((c) => OPEN.includes(c.status));
  const closed = cases.filter((c) => !OPEN.includes(c.status));

  return (
    <>
      <PageHeader
        title="My tickets"
        description="Everything you have raised with us, and where each one stands."
      >
        <Button asChild><Link href="/support/new">Raise a ticket</Link></Button>
      </PageHeader>

      {cases.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Ticket className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium">No tickets yet</p>
              <p className="text-sm text-muted-foreground">
                When something needs our help, raise a ticket and you can follow it here.
              </p>
            </div>
            <Button asChild><Link href="/support/new">Raise your first ticket</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          <TicketList title="Open" rows={open} emptyNote="Nothing open right now." />
          {closed.length > 0 && <TicketList title="Closed" rows={closed} />}
        </div>
      )}
    </>
  );
}

function TicketList({
  title,
  rows,
  emptyNote,
}: {
  title: string;
  rows: Awaited<ReturnType<typeof listMyCases>>;
  emptyNote?: string;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
        {title} <span className="font-normal">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{emptyNote}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={`/support/tickets/${row.id}`}
                className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{row.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.caseNumber} · raised {formatDate(row.createdAt)}
                    {row.raisedBy && ` · by ${row.raisedBy}`}
                  </p>
                </div>
                <Badge tone={statusTone(row.priority)}>{humanize(row.priority)}</Badge>
                <Badge tone={statusTone(row.status)}>{humanize(row.status)}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
