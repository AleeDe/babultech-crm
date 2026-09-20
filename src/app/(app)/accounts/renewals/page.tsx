import Link from "next/link";
import { PageHeader, Button, Forbidden, Badge } from "@/components/ui";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { RENEWAL_WINDOWS, renewalStage, type RenewalWindow } from "@/lib/account-health";
import { getRenewalQueue } from "@/server/account-health";

const stageLabels: Record<ReturnType<typeof renewalStage>, string> = {
  LAPSED: "Already ended",
  NOTICE_DUE: "Notice deadline",
  DUE_SOON: "Ending soon",
  UPCOMING: "Upcoming",
};
const stageTones = {
  LAPSED: "danger", NOTICE_DUE: "danger", DUE_SOON: "warning", UPCOMING: "info",
} as const;

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="renewals" />;

  const params = await searchParams;
  const requested = Number(params.window);
  const window = (RENEWAL_WINDOWS as readonly number[]).includes(requested)
    ? (requested as RenewalWindow)
    : 90;

  const { rows, scanned, truncated, today } = await getRenewalQueue(window);
  const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

  return (
    <>
      <PageHeader
        title="Renewals"
        description="Contracts ending soon, and any that have already run out. Dates come from each contract; nothing here renews anything on its own."
      >
        <Button asChild variant="outline"><Link href="/contracts">All contracts</Link></Button>
      </PageHeader>

      <nav aria-label="Renewal windows" className="my-5 flex flex-wrap gap-2">
        {RENEWAL_WINDOWS.map((value) => (
          <Button key={value} asChild variant={value === window ? undefined : "outline"}>
            <Link aria-current={value === window ? "page" : undefined} href={`/accounts/renewals?window=${value}`}>
              Next {value} days
            </Link>
          </Button>
        ))}
      </nav>

      <p className="mb-4 text-sm text-muted-foreground">
        {rows.length} agreement{rows.length === 1 ? "" : "s"} within {window} days, out of {scanned} scanned.
        {truncated && " More exist than were scanned; narrow the window or review the contract and subscription lists directly."}
      </p>

      <div className="space-y-4">
        {rows.map((row) => {
          const stage = renewalStage(row);
          return (
            <article key={`${row.source}-${row.id}`} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link
                    className="font-semibold text-primary"
                    href={`/contracts/${row.id}`}
                  >
                    {row.name}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    <Link className="underline" href={`/accounts/${row.accountId}`}>{row.accountName}</Link>
                    {" · "}{row.reference}
                    {" · "}{row.source === "CONTRACT" ? "Contract" : "Subscription"}
                  </p>
                </div>
                <Badge tone={stageTones[stage]}>{stageLabels[stage]}</Badge>
              </div>

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Ends</dt>
                  <dd>
                    {dates.format(new Date(`${row.endDate}T00:00:00Z`))}
                    {row.daysToEnd < 0
                      ? ` · ${Math.abs(row.daysToEnd)} days ago`
                      : ` · in ${row.daysToEnd} days`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Notice by</dt>
                  <dd>
                    {row.noticeBy
                      ? `${dates.format(new Date(`${row.noticeBy}T00:00:00Z`))}${row.noticeUrgent ? " · due now" : ""}`
                      : "No notice period agreed"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Account manager</dt>
                  <dd>{row.ownerName ?? <span className="text-red-600">Nobody named</span>}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Value</dt>
                  <dd>
                    {money(row.value, row.currencyCode)}
                    {" · "}{row.renewalType === "AUTO_RENEW" ? "Auto-renews" : "Manual renewal"}
                  </dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>

      {rows.length === 0 && (
        <p className="rounded-xl border p-6">
          Nothing ends within {window} days. Try a wider window, or check that your contracts
          carry an end date - an open-ended contract has no renewal to chase.
        </p>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Reviewed against {dates.format(new Date(`${today}T00:00:00Z`))}. An auto-renewing contract still
        appears here: it renews by its own terms, which is not the same as somebody having checked it.
      </p>
    </>
  );
}
