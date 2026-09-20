import { notFound } from "next/navigation";
import { getMyCase } from "@/server/support-portal";
import {
  PageHeader, Badge, statusTone, Card, CardContent, CardHeader, CardTitle, Alert,
} from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/utils";
import { ReplyForm } from "./reply-form";

const CLOSED = ["RESOLVED", "CLOSED", "CANCELLED"];

/** One ticket, and the conversation on it. */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ticket = await getMyCase(id);
  if (!ticket) notFound();

  const closed = CLOSED.includes(ticket.status);

  return (
    <>
      <PageHeader
        backTo="/support"
        backLabel="Back to my tickets"
        title={ticket.subject}
        description={`${ticket.caseNumber} · raised ${formatDateTime(ticket.createdAt)}${ticket.raisedBy ? ` by ${ticket.raisedBy}` : ""}`}
      >
        <Badge tone={statusTone(ticket.priority)}>{humanize(ticket.priority)}</Badge>
        <Badge tone={statusTone(ticket.status)}>{humanize(ticket.status)}</Badge>
      </PageHeader>

      <div className="max-w-3xl space-y-5">
        {ticket.resolution && (
          <Alert tone="success">
            <p className="font-medium">How we resolved it</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{ticket.resolution}</p>
          </Alert>
        )}

        <Card>
          <CardHeader><CardTitle>What you told us</CardTitle></CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            Conversation {ticket.comments.length > 0 && `(${ticket.comments.length})`}
          </h2>

          {ticket.comments.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              Nothing yet. Our team will reply here, and you will see it on this page.
            </p>
          ) : (
            <ul className="space-y-3">
              {ticket.comments.map((comment) => (
                <li
                  key={comment.id}
                  className={`rounded-lg border p-4 ${comment.fromUs ? "bg-primary/5" : "bg-card"}`}
                >
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{comment.author}</span>
                    {" · "}{formatDateTime(comment.createdAt)}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{comment.body}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {closed ? (
          <Alert tone="info">
            This ticket is {humanize(ticket.status).toLowerCase()}. If the problem is back, raise a
            new ticket and mention this number - {ticket.caseNumber} - so we have the history.
          </Alert>
        ) : (
          <ReplyForm caseId={ticket.id} />
        )}
      </div>
    </>
  );
}
