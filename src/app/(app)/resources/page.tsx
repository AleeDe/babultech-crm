import Link from "next/link";
import { getUtilisation } from "@/server/timesheets";
import {
  PageHeader, Card, CardContent, Table, THead, TBody, TR, TH, TD,
  Badge, StatTile, Select, Button, Forbidden
} from "@/components/ui";
import { formatDate, formatNumber, formatMoney } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";

/**
 * Resource utilisation. "Resources" here are the people using this system —
 * their user record is their employee record, so a rate change follows them
 * across every project they touch.
 */
export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.PROJECT_READ)) return <Forbidden what="resource utilisation" />;

  const { weeks } = await searchParams;
  const window = Math.min(Math.max(Number(weeks) || 4, 1), 26);
  const data = await getUtilisation(window);

  const totalLogged = data.rows.reduce((s, r) => s + Number(r.loggedHours), 0);
  const totalBillable = data.rows.reduce((s, r) => s + Number(r.billableHours), 0);
  const overbooked = data.rows.filter((r) => r.allocatedPercent > 100);
  const idle = data.rows.filter((r) => r.allocatedPercent === 0);
  const billableRatio = totalLogged > 0 ? (totalBillable / totalLogged) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Resources"
        description={`Allocation is what people are booked for; logged hours are what actually happened. ${formatDate(data.from)} – ${formatDate(data.to)}.`}
      >
        <form className="flex items-center gap-2">
          <Select name="weeks" defaultValue={String(window)} className="w-36">
            {[1, 2, 4, 8, 13, 26].map((w) => (
              <option key={w} value={w}>Last {w} week{w > 1 ? "s" : ""}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Apply</Button>
        </form>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="People" value={String(data.rows.length)} sublabel={`${formatNumber(Number(data.capacityHours), 0)}h capacity each`} />
        <StatTile label="Hours logged" value={formatNumber(totalLogged, 1)} />
        <StatTile
          label="Billable ratio"
          value={`${formatNumber(billableRatio, 1)}%`}
          sublabel={`${formatNumber(totalBillable, 1)}h billable`}
          tone={billableRatio >= 70 ? "success" : billableRatio >= 50 ? "warning" : "danger"}
        />
        <StatTile
          label="Over-allocated"
          value={String(overbooked.length)}
          sublabel={idle.length > 0 ? `${idle.length} on no project` : undefined}
          tone={overbooked.length ? "danger" : "success"}
        />
      </div>

      <Card className="mt-6">
        <CardContent className="px-0">
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH>Projects</TH>
                <TH className="text-right">Allocated</TH>
                <TH className="text-right">Logged</TH>
                <TH className="text-right">Billable</TH>
                <TH className="text-right">Utilisation</TH>
                <TH className="text-right">Rates</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => {
                const over = r.allocatedPercent > 100;
                return (
                  <TR key={r.user.id} id={r.user.id}>
                    <TD>
                      <span className="font-medium">{r.user.fullName}</span>
                      <p className="text-xs text-muted-foreground">
                        {r.user.jobTitle ?? "—"}
                        {r.user.department && ` · ${r.user.department.name}`}
                      </p>
                    </TD>
                    <TD className="text-sm">
                      {r.projects.length === 0 ? (
                        <span className="text-muted-foreground">Not booked</span>
                      ) : (
                        <div className="space-y-0.5">
                          {r.projects.map((p) => (
                            <Link key={p.id} href={`/projects/${p.id}`} className="block hover:underline">
                              {p.name}
                              <span className="text-xs text-muted-foreground">
                                {" "}({formatNumber(p.allocationPercent ?? 0, 0)}%)
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </TD>
                    <TD className="text-right">
                      <Badge tone={over ? "danger" : r.allocatedPercent === 0 ? "neutral" : "info"}>
                        {formatNumber(r.allocatedPercent, 0)}%
                      </Badge>
                    </TD>
                    <TD className="text-right tabular">{formatNumber(r.loggedHours, 1)}</TD>
                    <TD className="text-right tabular">{formatNumber(r.billableHours, 1)}</TD>
                    <TD className="text-right">
                      <div className="ml-auto w-24">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className={
                              r.billableUtilisationPercent >= 70
                                ? "h-full bg-emerald-500"
                                : r.billableUtilisationPercent >= 40
                                  ? "h-full bg-amber-500"
                                  : "h-full bg-red-500"
                            }
                            style={{ width: `${Math.min(r.utilisationPercent, 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs tabular text-muted-foreground">
                          {formatNumber(r.billableUtilisationPercent, 0)}% billable
                        </p>
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap text-right text-xs text-muted-foreground">
                      <p>Bill {formatMoney(r.user.defaultBillingRate)}</p>
                      <p>Cost {formatMoney(r.user.costRate)}</p>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
