import Link from "next/link";
import { PageHeader, Button, Forbidden, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { requireUser, can, canAny, PERMISSIONS } from "@/lib/authz";
import { one } from "@/lib/decimal";
import { monthLabel } from "@/lib/recurring-billing";
import { listPeriodLocks, getClosableMonths } from "@/server/recurring-billing";
import { PeriodForms } from "./forms";

export default async function PeriodsPage() {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.INVOICE_READ)) return <Forbidden what="accounting periods" />;

  const [locks, closable] = await Promise.all([listPeriodLocks(), getClosableMonths()]);
  const mayClose = canAny(user, PERMISSIONS.PERIOD_CLOSE, PERMISSIONS.INVOICE_APPROVE);
  const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const closed = locks.filter((l) => !l.reopenedAt);
  const reopened = locks.filter((l) => l.reopenedAt);

  return (
    <>
      <PageHeader
        title="Accounting periods"
        description="Closing a month stops its invoices, payments and expenses being changed. Corrections belong in an open month, where they can be seen."
      >
        <Button asChild variant="outline"><Link href="/invoices">Invoices</Link></Button>
      </PageHeader>

      {mayClose && <PeriodForms closable={closable} closed={closed.map((l) => l.periodStart as string)} />}

      {!mayClose && (
        <p className="my-5 rounded-xl border p-5 text-sm text-muted-foreground">
          You can see which months are closed. Closing or reopening one needs period-closing authority.
        </p>
      )}

      <Card className="my-6">
        <CardHeader><CardTitle>Closed months</CardTitle></CardHeader>
        <CardContent>
          {closed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No month is closed. Every period is still editable.
            </p>
          ) : (
            <ul className="space-y-4">
              {closed.map((lock) => (
                <li key={lock.periodStart as string} className="rounded-lg border p-4">
                  <p className="font-medium">{monthLabel(lock.periodStart as string)}</p>
                  <p className="text-sm text-muted-foreground">
                    Closed by {(one(lock.closedBy as never) as { fullName: string } | null)?.fullName ?? "a former user"}
                    {lock.closedAt ? ` on ${dates.format(new Date(lock.closedAt as string))}` : ""}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{lock.note as string}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {reopened.length > 0 && (
        <Card className="my-6">
          <CardHeader><CardTitle>Reopened months</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              These months were closed and then opened again. They are editable now; the record is kept
              so the reopening is visible rather than silent.
            </p>
            <ul className="space-y-4">
              {reopened.map((lock) => (
                <li key={lock.periodStart as string} className="rounded-lg border p-4">
                  <p className="font-medium">{monthLabel(lock.periodStart as string)}</p>
                  <p className="text-sm text-muted-foreground">
                    Reopened by {(one(lock.reopenedBy as never) as { fullName: string } | null)?.fullName ?? "a former user"}
                    {lock.reopenedAt ? ` on ${dates.format(new Date(lock.reopenedAt as string))}` : ""}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{lock.reopenNote as string}</p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
