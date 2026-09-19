import Link from "next/link";
import { PageHeader, Button, Forbidden, Badge } from "@/components/ui";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { humanize } from "@/lib/utils";
import { describe } from "@/lib/subscriptions";
import { listSubscriptions } from "@/server/subscriptions";

const tones = {
  ACTIVE: "success", DRAFT: "info", PAUSED: "warning",
  CANCELLED: "danger", ENDED: "neutral",
} as const;

export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  if (!can(user, PERMISSIONS.ACCOUNT_READ)) return <Forbidden what="subscriptions" />;

  const params = await searchParams;
  const rows = await listSubscriptions();
  const filters = ["ACTIVE", "DRAFT", "PAUSED", "ALL"] as const;
  const status = (filters as readonly string[]).includes(params.status ?? "") ? params.status! : "ACTIVE";
  const visible = status === "ALL" ? rows : rows.filter((r) => r.status === status);

  const dates = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeZone: "UTC" });
  const money = (amount: number, currency: string) =>
    new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="What each customer agreed to: the plan, the quantity and the price. A period bills the quantity in force when it started, so a mid-period change applies from the next one."
      >
        {can(user, PERMISSIONS.OPPORTUNITY_WRITE) && (
          <Button asChild><Link href="/subscriptions/new">New subscription</Link></Button>
        )}
      </PageHeader>

      <nav aria-label="Subscription status" className="my-5 flex flex-wrap gap-2">
        {filters.map((value) => (
          <Button key={value} asChild variant={value === status ? undefined : "outline"}>
            <Link aria-current={value === status ? "page" : undefined} href={`/subscriptions?status=${value}`}>
              {value === "ALL" ? "All" : humanize(value)} ({value === "ALL" ? rows.length : rows.filter((r) => r.status === value).length})
            </Link>
          </Button>
        ))}
      </nav>

      <div className="space-y-4">
        {visible.map((row) => {
          const account = row.account as { id: string; name: string } | null;
          const product = row.product as { id: string; name: string } | null;
          const quantityChanged = row.currentQuantity !== Number(row.quantity);
          const pending = row.pendingChange as { quantity: number; effectiveFrom: string } | null;
          return (
            <article key={row.id as string} className="rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <Link className="font-semibold text-primary" href={`/subscriptions/${row.id}`}>
                    {product?.name ?? "Product"} — {describe({
                      quantity: row.currentQuantity,
                      plan: row.plan as never,
                      unitPrice: Number(row.unitPrice),
                      currencyCode: row.currencyCode as string,
                    })}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {account ? <Link className="underline" href={`/accounts/${account.id}`}>{account.name}</Link> : "No account"}
                    {" · "}{row.subscriptionNumber as string}
                  </p>
                </div>
                <Badge tone={tones[row.status as keyof typeof tones] ?? "neutral"}>{humanize(row.status as string)}</Badge>
              </div>

              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Price</dt>
                  <dd>
                    {money(Number(row.unitPrice), row.currencyCode as string)} each ·{" "}
                    {humanize(row.billingFrequency as string)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Period total</dt>
                  <dd>{money(row.currentQuantity * Number(row.unitPrice), row.currencyCode as string)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Next billing</dt>
                  <dd>
                    {row.nextBillingDate
                      ? dates.format(new Date(`${row.nextBillingDate}T00:00:00Z`))
                      : row.status === "ACTIVE" ? "Nothing outstanding" : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Runs</dt>
                  <dd>
                    {dates.format(new Date(`${row.startDate}T00:00:00Z`))}
                    {row.endDate ? ` to ${dates.format(new Date(`${row.endDate}T00:00:00Z`))}` : " onwards"}
                  </dd>
                </div>
              </dl>

              {(quantityChanged || pending) && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {quantityChanged && `Originally ${String(row.quantity)}; now ${row.currentQuantity}.`}
                  {quantityChanged && pending ? " " : ""}
                  {pending && `Changing to ${pending.quantity} from ${dates.format(new Date(`${pending.effectiveFrom}T00:00:00Z`))}.`}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {visible.length === 0 && (
        <p className="rounded-xl border p-6">
          {rows.length === 0
            ? "No customer subscriptions yet. A subscription records what one customer agreed to pay for a product plan."
            : "Nothing with that status."}
        </p>
      )}
    </>
  );
}
