import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listEmailBatches } from "@/server/activities";
import {
  PageHeader, Forbidden, Card, CardContent, Table, THead, TBody, TR, TH, TD,
  EmptyState, StatTile, Badge,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

/**
 * Every email that has gone out, newest first.
 *
 * Rates rather than raw counts in the list, because "62 opens" means nothing
 * without knowing it went to 500 people. The counts are on each send's own page.
 */
export default async function SendsPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.LEAD_READ)) return <Forbidden what="email sends" />;

  const batches = await listEmailBatches();

  const totalSent = batches.reduce((sum, b) => sum + b.stats.sent, 0);
  const totalClicked = batches.reduce((sum, b) => sum + b.stats.clicked, 0);
  const totalBounced = batches.reduce((sum, b) => sum + b.stats.bounced, 0);

  const rate = (n: number, of: number) => (of === 0 ? "—" : `${Math.round((n / of) * 100)}%`);

  return (
    <>
      <PageHeader
        backTo="/leads"
        backLabel="Back to leads"
        title="Emails sent"
        description="Each send, and how the people it reached responded."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Emails sent" value={String(totalSent)} sublabel={`${batches.length} send(s)`} />
        <StatTile
          label="Clicked"
          value={String(totalClicked)}
          sublabel={rate(totalClicked, totalSent)}
          tone="info"
        />
        <StatTile
          label="Bounced"
          value={String(totalBounced)}
          sublabel={rate(totalBounced, totalSent)}
          tone={totalBounced > 0 ? "warning" : "neutral"}
        />
      </div>

      <Card className="mt-6">
        {batches.length === 0 ? (
          <div className="py-10">
            <EmptyState
              title="Nothing sent yet"
              description="Choose some leads on the leads list and press Email. Each send appears here with its results."
            />
          </div>
        ) : (
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>Subject</TH>
                  <TH priority="tertiary">Sent by</TH>
                  <TH>When</TH>
                  <TH className="text-right">To</TH>
                  <TH className="text-right">Delivered</TH>
                  <TH className="text-right">Clicked</TH>
                  <TH className="text-right" priority="secondary">Opened</TH>
                  <TH priority="secondary">Trouble</TH>
                </TR>
              </THead>
              <TBody>
                {batches.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <Link
                        href={`/leads/email/sends/${b.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {b.subject}
                      </Link>
                      {b.skippedCount > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {b.skippedCount} left out
                        </p>
                      )}
                    </TD>
                    <TD className="text-sm" priority="tertiary">{b.sentBy?.fullName ?? "—"}</TD>
                    <TD className="text-sm">{formatDateTime(b.sentAt)}</TD>
                    <TD className="text-right text-sm tabular-nums">{b.stats.sent}</TD>
                    <TD className="text-right text-sm tabular-nums">
                      {rate(b.stats.delivered, b.stats.sent)}
                    </TD>
                    <TD className="text-right text-sm font-medium tabular-nums">
                      {rate(b.stats.clicked, b.stats.sent)}
                    </TD>
                    <TD className="text-right text-sm tabular-nums" priority="secondary">
                      {rate(b.stats.opened, b.stats.sent)}
                    </TD>
                    <TD priority="secondary">
                      {b.stats.bounced === 0 && b.stats.unsubscribed === 0 && b.stats.failed === 0 ? (
                        <span className="text-sm text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {b.stats.bounced > 0 && (
                            <Badge tone="danger">{b.stats.bounced} bounced</Badge>
                          )}
                          {b.stats.unsubscribed > 0 && (
                            <Badge tone="warning">{b.stats.unsubscribed} left</Badge>
                          )}
                          {b.stats.failed > 0 && <Badge tone="danger">{b.stats.failed} failed</Badge>}
                        </div>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        )}
      </Card>
    </>
  );
}
