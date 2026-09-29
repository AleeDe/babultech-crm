import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listRecycleBin } from "@/server/recycle-bin";
import { RECYCLE_TYPES, type RecycleType } from "@/lib/recycle-types";
import { PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState, Forbidden } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { RecycleActions } from "./recycle-actions";

const DAY = 86_400_000;

export default async function RecycleBinPage() {
  const me = await requireUser();
  const allowed = (Object.keys(RECYCLE_TYPES) as RecycleType[]).some((t) => can(me, RECYCLE_TYPES[t].permission));
  if (!allowed) return <Forbidden what="the recycle bin" />;
  const isAdmin = can(me, PERMISSIONS.ADMIN);
  const items = await listRecycleBin();

  return (
    <>
      <PageHeader
        title="Recycle bin"
        description="Deleted leads, accounts, contacts, deals, cases and campaigns. Each can be restored for 90 days, then it is erased for good."
      />
      <Card>
        {items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="The recycle bin is empty" description="Something you delete from its page waits here in case it is wanted back." />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Record</TH>
                <TH>Kind</TH>
                <TH priority="secondary">Deleted</TH>
                <TH priority="secondary">By</TH>
                <TH>Erased in</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {items.map((item) => {
                const deletedAt = new Date(/[zZ]$/.test(item.deletedAt) ? item.deletedAt : `${item.deletedAt}Z`).getTime();
                const daysLeft = Math.max(0, Math.ceil((deletedAt + 90 * DAY - Date.now()) / DAY));
                return (
                  <TR key={`${item.type}:${item.id}`}>
                    <TD className="text-sm font-medium">
                      <Link href={item.href} className="hover:underline">{item.label}</Link>
                    </TD>
                    <TD><Badge tone="neutral">{item.typeLabel}</Badge></TD>
                    <TD className="text-sm" priority="secondary">{formatDateTime(item.deletedAt)}</TD>
                    <TD className="text-sm" priority="secondary">{item.deletedByName ?? "—"}</TD>
                    <TD className="text-sm tabular-nums">{daysLeft} day{daysLeft === 1 ? "" : "s"}</TD>
                    <TD className="text-right">
                      <RecycleActions type={item.type} id={item.id} name={item.label} canErase={isAdmin} />
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
