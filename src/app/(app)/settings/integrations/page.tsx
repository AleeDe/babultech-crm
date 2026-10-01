import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listWebhooks, listIntegrationLog } from "@/server/integrations";
import { PageHeader, Forbidden, Card, CardHeader, CardTitle, CardContent, Badge, Table, THead, TBody, TR, TH, TD, StatTile, Button } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { RECORD_PATHS } from "@/lib/record-paths";
import { WebhooksPanel, RetryButton } from "./webhooks-panel";

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  SUCCESS: "success",
  PENDING: "info",
  SENDING: "info",
  FAILED: "warning",
  GAVE_UP: "danger",
};

/** Webhooks, and the log of every call made to or from another system. */
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="settings" />;
  const { status } = await searchParams;
  const [webhooks, log, all] = await Promise.all([
    listWebhooks(),
    listIntegrationLog({ status: status || undefined }),
    status ? listIntegrationLog() : Promise.resolve(null),
  ]);
  const everything = all ?? log;
  const count = (s: string) => everything.filter((r) => r.status === s).length;

  return (
    <>
      <PageHeader
        backTo="/settings"
        backLabel="Back to settings"
        title="Webhooks and integrations"
        description="Tell other systems when something happens here, and see every call that was made. Failed calls are retried after 1, 5 and 30 minutes, then 2 and 12 hours."
      />

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile label="Delivered" value={String(count("SUCCESS"))} tone="success" href="/settings/integrations?status=SUCCESS" />
        <StatTile label="Waiting" value={String(count("PENDING") + count("SENDING"))} href="/settings/integrations?status=PENDING" />
        <StatTile label="Retrying" value={String(count("FAILED"))} tone={count("FAILED") ? "warning" : "neutral"} href="/settings/integrations?status=FAILED" />
        <StatTile label="Given up" value={String(count("GAVE_UP"))} tone={count("GAVE_UP") ? "danger" : "neutral"} href="/settings/integrations?status=GAVE_UP" />
      </div>

      <div className="mt-6">
        <WebhooksPanel webhooks={webhooks} />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Integration log{status ? ` - ${status.toLowerCase().replace("_", " ")}` : ""}</CardTitle>
          {status && <Button asChild size="sm" variant="ghost"><Link href="/settings/integrations">Show all</Link></Button>}
        </CardHeader>
        <CardContent className="px-0">
          {log.length === 0 ? (
            <p className="px-5 pb-2 text-sm text-muted-foreground">Nothing yet. A call shows here as soon as it is queued.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Event</TH>
                  <TH priority="secondary">To</TH>
                  <TH>Status</TH>
                  <TH priority="secondary">Answer</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {log.map((r) => {
                  const path = r.relatedEntityType ? RECORD_PATHS[r.relatedEntityType] : null;
                  return (
                    <TR key={r.id} data-log-event={r.event}>
                      <TD className="whitespace-nowrap text-sm">{formatDateTime(r.createdAt)}</TD>
                      <TD className="text-sm">
                        <span className="font-mono text-xs">{r.event}</span>
                        {path && r.relatedEntityId && (
                          <Link href={`${path}${r.relatedEntityId}`} className="ml-2 text-xs text-primary hover:underline">record</Link>
                        )}
                      </TD>
                      <TD priority="secondary" className="max-w-xs truncate text-xs text-muted-foreground">{r.webhookName ?? r.endpoint ?? "—"}</TD>
                      <TD>
                        <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status.toLowerCase().replace("_", " ")}</Badge>
                        {r.attempts > 1 && <span className="ml-1 text-xs text-muted-foreground">{r.attempts} tries</span>}
                      </TD>
                      <TD priority="secondary" className="text-xs text-muted-foreground">
                        {r.httpStatus ? `HTTP ${r.httpStatus}` : ""}{r.durationMs != null ? ` · ${r.durationMs} ms` : ""}
                        {r.errorMessage && <span className="block text-destructive">{r.errorMessage}</span>}
                        {r.status === "FAILED" && r.nextAttemptAt && <span className="block">Next try {formatDateTime(r.nextAttemptAt)}</span>}
                      </TD>
                      <TD className="text-right">{(r.status === "FAILED" || r.status === "GAVE_UP") && <RetryButton id={r.id} />}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
