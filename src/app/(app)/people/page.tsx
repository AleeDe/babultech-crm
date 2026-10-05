import Link from "next/link";
import { requireUser, can, canAny, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Button, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState, StatTile, Input, Select, Forbidden,
} from "@/components/ui";
import { listPeople } from "@/server/people";
import { CONTRACT_TYPES, CONTRACT_TYPE_LABELS, CONTRACT_STATUS_LABELS, contractTone, daysUntil, type ContractStatus, type ContractType } from "@/lib/people";
import { formatDate, humanize } from "@/lib/utils";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; type?: string; ending?: string }>;
}) {
  const me = await requireUser();
  if (!canAny(me, PERMISSIONS.PEOPLE_READ, PERMISSIONS.PEOPLE_WRITE)) return <Forbidden what="People" />;
  const canWrite = can(me, PERMISSIONS.PEOPLE_WRITE);
  const params = await searchParams;
  const [people, everyone] = await Promise.all([listPeople(params), listPeople({})]);

  const active = everyone.filter((p) => p.current?.status === "ACTIVE");
  const ending = active.filter((p) => daysUntil(p.current!.endDate) <= 30);
  const signing = everyone.filter((p) => ["DRAFT", "SENT", "EMPLOYEE_SIGNED", "SIGNED"].includes(p.current?.status ?? ""));

  return (
    <>
      <PageHeader title="People" description="Everyone hired, their contracts, and what happens when each one ends.">
        {canWrite && <Button asChild variant="outline"><Link href="/people/templates">Contract templates</Link></Button>}
        {canWrite && <Button asChild><Link href="/people/new">Hire someone</Link></Button>}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Working now" value={String(active.length)} sublabel="On an active contract" />
        <StatTile label="Interns and trainees" value={String(active.filter((p) => ["INTERNSHIP", "TRAINING"].includes(p.current!.contractType)).length)} sublabel="Active" />
        <StatTile label="Ending in 30 days" value={String(ending.length)} sublabel="Renew, convert or let end" tone={ending.length ? "warning" : "neutral"} href="/people?ending=30" />
        <StatTile label="Being signed" value={String(signing.length)} sublabel="Draft, sent or waiting to start" tone="info" />
      </div>

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-[200px] flex-1">
            <Input name="search" placeholder="Search name, number or email…" defaultValue={params.search} />
          </div>
          <Select name="type" defaultValue={params.type ?? ""} className="w-52">
            <option value="">All kinds of contract</option>
            {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{CONTRACT_TYPE_LABELS[t]}</option>)}
          </Select>
          <Select name="status" defaultValue={params.status ?? ""} className="w-40">
            <option value="">Everyone</option>
            <option value="ONBOARDING">Onboarding</option>
            <option value="ACTIVE">Working</option>
            <option value="LEFT">Left</option>
          </Select>
          <Select name="ending" defaultValue={params.ending ?? ""} className="w-44">
            <option value="">Any end date</option>
            <option value="7">Ending in 7 days</option>
            <option value="30">Ending in 30 days</option>
            <option value="90">Ending in 90 days</option>
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {people.length === 0 ? (
          <EmptyState
            title={everyone.length ? "Nobody matches" : "Nobody hired here yet"}
            description="Hiring someone takes their details, prepares their contract and creates their login. Existing colleagues can be given a profile and contract the same way."
            action={canWrite ? <Button asChild><Link href="/people/new">Hire someone</Link></Button> : undefined}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH>Position</TH>
                <TH>Contract</TH>
                <TH>Term</TH>
                <TH>Status</TH>
                <TH><span className="sr-only">Actions</span></TH>
              </TR>
            </THead>
            <TBody>
              {people.map((p) => {
                const c = p.current;
                const left = c?.status === "ACTIVE" ? daysUntil(c.endDate) : null;
                return (
                  <TR key={p.id}>
                    <TD>
                      <Link href={`/people/${p.id}`} className="font-medium hover:underline">{p.fullName}</Link>
                      <p className="text-xs text-muted-foreground">{p.profileNumber}{p.userId ? "" : " · no login yet"}</p>
                    </TD>
                    <TD className="text-sm">{c?.jobTitle ?? "—"}</TD>
                    <TD className="text-sm">
                      {c ? <Link href={`/people/contracts/${c.id}`} className="hover:underline">{CONTRACT_TYPE_LABELS[c.contractType as ContractType]}</Link> : "—"}
                      {c && <p className="text-xs text-muted-foreground">{c.contractNumber}</p>}
                    </TD>
                    <TD className="text-sm">
                      {c ? `${formatDate(c.startDate)} – ${formatDate(c.endDate)}` : "—"}
                      {left != null && left <= 30 && (
                        <p className={left <= 7 ? "text-xs text-red-600 dark:text-red-400" : "text-xs text-amber-600 dark:text-amber-400"}>
                          {left === 0 ? "Ends today" : `Ends in ${left} day${left === 1 ? "" : "s"}`}
                        </p>
                      )}
                      {c?.lastWorkingDay && <p className="text-xs text-muted-foreground">Last day {formatDate(c.lastWorkingDay)}</p>}
                    </TD>
                    <TD>
                      {c ? <Badge tone={contractTone(c.status)}>{CONTRACT_STATUS_LABELS[c.status as ContractStatus] ?? humanize(c.status)}</Badge> : <Badge tone="neutral">{humanize(p.status)}</Badge>}
                    </TD>
                    <TD className="text-right text-sm">
                      <span className="inline-flex gap-3">
                        {canWrite && <Link href={`/people/${p.id}/edit`} className="text-primary hover:underline">Edit</Link>}
                        <Link href={`/people/${p.id}`} className="text-primary hover:underline">Open</Link>
                      </span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
