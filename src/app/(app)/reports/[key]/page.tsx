import { notFound } from "next/navigation";
import { requireUser, can } from "@/lib/authz";
import { REPORTS, type ReportKey } from "@/lib/reports";
import { runReport, listMySchedules } from "@/server/reports";
import { getAssignableUsers } from "@/server/bulk";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, Forbidden, Input, Select, Button, EmptyState } from "@/components/ui";
import { FilterForm } from "@/components/filter-form";
import { formatMoney } from "@/lib/utils";
import { ReportTools } from "./report-tools";

function show(value: string | number | null | undefined, kind?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "money") return formatMoney(Number(value));
  if (kind === "percent") return `${value}%`;
  if (kind === "hours") return `${value} h`;
  if (kind === "number") return Number(value).toLocaleString("en-PK");
  return String(value);
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ from?: string; to?: string; ownerId?: string }>;
}) {
  const me = await requireUser();
  const { key } = await params;
  const report = REPORTS.find((r) => r.key === key);
  if (!report) notFound();
  if (!can(me, report.permission)) return <Forbidden what="this report" />;
  const filters = await searchParams;
  const [result, users, schedules] = await Promise.all([
    runReport(report.key as ReportKey, filters),
    report.owner ? getAssignableUsers() : Promise.resolve([]),
    listMySchedules(report.key),
  ]);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader backTo="/reports" backLabel="Back to reports" title={report.title} description={report.description}>
        <ReportTools
          reportKey={report.key}
          title={report.title}
          query={query}
          columns={result.columns}
          rows={result.rows}
          totals={result.totals}
          scheduled={schedules.map((s) => s.frequency)}
        />
      </PageHeader>

      {(report.dated || report.owner) && (
        <Card className="mb-6">
          <FilterForm className="flex flex-wrap items-end gap-3 p-4">
            {report.dated && (
              <>
                <label className="text-xs text-muted-foreground">From<Input name="from" type="date" defaultValue={filters.from} className="mt-1 w-40" /></label>
                <label className="text-xs text-muted-foreground">To<Input name="to" type="date" defaultValue={filters.to} className="mt-1 w-40" /></label>
              </>
            )}
            {report.owner && (
              <Select name="ownerId" defaultValue={filters.ownerId ?? ""} className="w-52" aria-label="Owner">
                <option value="">Every owner</option>
                {users.map((u: { id: string; fullName: string }) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </Select>
            )}
            <Button type="button" variant="secondary">Apply</Button>
          </FilterForm>
        </Card>
      )}

      <Card>
        {result.rows.length === 0 ? (
          <div className="p-6"><EmptyState title="Nothing to show" description="No records match these filters." /></div>
        ) : (
          <Table>
            <THead>
              <TR>
                {result.columns.map((c) => (
                  <TH key={c.key} className={c.kind && c.kind !== "text" ? "text-right" : undefined}>{c.label}</TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {result.rows.map((row, i) => (
                <TR key={i}>
                  {result.columns.map((c) => (
                    <TD key={c.key} className={`text-sm ${c.kind && c.kind !== "text" ? "text-right tabular-nums" : ""}`}>{show(row[c.key], c.kind)}</TD>
                  ))}
                </TR>
              ))}
              {result.totals && (
                <TR className="border-t-2 font-semibold">
                  {result.columns.map((c) => (
                    <TD key={c.key} className={`text-sm ${c.kind && c.kind !== "text" ? "text-right tabular-nums" : ""}`}>{show(result.totals![c.key], c.kind)}</TD>
                  ))}
                </TR>
              )}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
