import { GitPullRequest } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, Badge, statusTone,
} from "@/components/ui";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

/**
 * Scope changes asked for after the project started.
 *
 * Cost and schedule impact are shown on every row because that is the whole
 * point of recording one: a change that adds fifteen days is the reason a
 * project misses its date, and it should be visible next to the request rather
 * than discovered at the end.
 */
export function ChangeRequestsPanel({
  changeRequests,
}: {
  changeRequests: Record<string, any>[];
}) {
  const pending = changeRequests.filter((c) => c.approvalStatus === "PENDING");
  const approved = changeRequests.filter((c) => c.approvalStatus === "APPROVED");

  const addedCost = approved.reduce((sum, c) => sum + Number(c.costImpact ?? 0), 0);
  const addedDays = approved.reduce((sum, c) => sum + Number(c.scheduleImpactDays ?? 0), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitPullRequest className="h-4 w-4 text-muted-foreground" />
          Change requests
          {pending.length > 0 && <Badge tone="warning">{pending.length} pending</Badge>}
        </CardTitle>
        <CardDescription>
          Scope asked for after the project started. Approved changes are what moved the budget and
          the end date.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {changeRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No change requests. Anything the customer asks for beyond the agreed scope belongs
            here — otherwise the project quietly absorbs it.
          </p>
        ) : (
          <>
            {approved.length > 0 && (
              <dl className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Approved cost impact</dt>
                  <dd className="font-medium tabular">{formatMoney(addedCost)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Approved schedule impact</dt>
                  <dd className="font-medium tabular">
                    {addedDays === 0 ? "None" : `+${addedDays} day${addedDays === 1 ? "" : "s"}`}
                  </dd>
                </div>
              </dl>
            )}

            <ul className="space-y-3">
              {changeRequests.map((cr) => (
                <li key={String(cr.id)} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{cr.title}</p>
                      <p className="font-mono text-xs text-muted-foreground">{cr.requestNumber}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Badge tone={statusTone(cr.approvalStatus)}>
                        {humanize(cr.approvalStatus)}
                      </Badge>
                      <Badge tone={statusTone(cr.status)}>{humanize(cr.status)}</Badge>
                    </div>
                  </div>

                  <p className="mt-2 text-sm text-muted-foreground">{cr.description}</p>

                  {cr.businessReason && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Why: </span>
                      {cr.businessReason}
                    </p>
                  )}

                  {cr.scopeImpact && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Scope: </span>
                      {cr.scopeImpact}
                    </p>
                  )}

                  <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>
                      <span className="text-muted-foreground">Cost </span>
                      <span className="font-medium tabular">
                        {Number(cr.costImpact ?? 0) === 0
                          ? "No change"
                          : formatMoney(cr.costImpact)}
                      </span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">Schedule </span>
                      <span
                        className={`font-medium tabular ${
                          Number(cr.scheduleImpactDays ?? 0) > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : ""
                        }`}
                      >
                        {Number(cr.scheduleImpactDays ?? 0) === 0
                          ? "No change"
                          : `+${cr.scheduleImpactDays} days`}
                      </span>
                    </span>
                    <span className="text-muted-foreground">
                      Raised {formatDate(cr.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
