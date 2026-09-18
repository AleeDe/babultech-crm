import Link from "next/link";
import { PageHeader, Button, Forbidden, Badge } from "@/components/ui";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { humanize } from "@/lib/utils";
import { getAccountHealth } from "@/server/account-health";

const tones = { RED: "danger", AMBER: "warning", GREEN: "success" } as const;

export default async function AccountHealthPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.ACCOUNT_READ)) return <Forbidden what="account health" />;

  const params = await searchParams;
  const show = ["all", "attention", "unowned", "onboarding", "disagreeing"].includes(params.show ?? "")
    ? (params.show as string)
    : "attention";

  const { rows, scanned, truncated, today } = await getAccountHealth();
  const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });

  const filters: Record<string, { label: string; rows: typeof rows }> = {
    attention: { label: "Needs attention", rows: rows.filter((r) => r.derived.status !== "GREEN") },
    unowned: { label: "No account manager", rows: rows.filter((r) => !r.ownerName) },
    onboarding: { label: "Onboarding", rows: rows.filter((r) => r.onboarding) },
    disagreeing: { label: "Stored health differs", rows: rows.filter((r) => r.disagrees) },
    all: { label: "All customers", rows },
  };
  const visible = filters[show].rows;

  return (
    <>
      <PageHeader
        title="Account health"
        description="Worked out from invoices, support cases, contact history and contracts. The stored health field is left alone; where the two disagree, both are shown."
      >
        <Button asChild variant="outline"><Link href="/accounts">All accounts</Link></Button>
      </PageHeader>

      <nav aria-label="Account health filters" className="my-5 flex flex-wrap gap-2">
        {Object.entries(filters).map(([key, filter]) => (
          <Button key={key} asChild variant={key === show ? undefined : "outline"}>
            <Link aria-current={key === show ? "page" : undefined} href={`/accounts/health?show=${key}`}>
              {filter.label} ({filter.rows.length})
            </Link>
          </Button>
        ))}
      </nav>

      <p className="mb-4 text-sm text-muted-foreground">
        {visible.length} of {scanned} customer account{scanned === 1 ? "" : "s"}.
        {truncated && " More accounts exist than were scanned."}
      </p>

      <div className="space-y-4">
        {visible.map((row) => (
          <article key={row.accountId} className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link className="font-semibold text-primary" href={`/accounts/${row.accountId}`}>
                  {row.accountName}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {row.ownerName
                    ? `Account manager: ${row.ownerName}`
                    : "No active account manager — nobody is answerable for this customer"}
                  {row.customerStatus ? ` · ${humanize(row.customerStatus)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tones[row.derived.status]}>{row.derived.status}</Badge>
                {row.disagrees && (
                  <span className="text-xs text-muted-foreground">
                    stored: {row.storedHealth ? humanize(row.storedHealth) : "not set"}
                  </span>
                )}
              </div>
            </div>

            {row.onboarding && (
              <p className={`mt-3 text-sm ${row.onboarding.overdue ? "text-red-600" : "text-muted-foreground"}`}>
                Onboarding for {row.onboarding.days} days
                {row.onboarding.overdue ? " — past the usual 30" : ""}
              </p>
            )}

            {row.derived.signals.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {row.derived.signals.map((signal) => (
                  <li key={signal.label} className="text-sm">
                    <span className="font-medium">{signal.label}</span>
                    <span className="text-muted-foreground"> — {signal.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Nothing in the records is flagging. That is not the same as a happy customer; it means
                no invoice is overdue, no case is breached and somebody has been in touch recently.
              </p>
            )}
          </article>
        ))}
      </div>

      {visible.length === 0 && (
        <p className="rounded-xl border p-6">Nothing in this view.</p>
      )}

      <p className="mt-6 text-xs text-muted-foreground">
        Reviewed against {dates.format(new Date(`${today}T00:00:00Z`))}. These signals come from what has
        been recorded in the CRM, so an account nobody logs work against will look quiet rather than well.
      </p>
    </>
  );
}
