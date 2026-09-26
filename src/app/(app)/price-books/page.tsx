import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listPriceBooks } from "@/server/price-books";
import {
  PageHeader, Forbidden, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState,
} from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { NewPriceBook } from "./new-price-book";

/**
 * Price books: our prices for a period.
 *
 * Each book prices many products and services, and a deal is priced from one
 * book. Next year's rates start as a copy of this year's book, so last year's
 * deals keep pointing at the prices they were actually sold on.
 */
export default async function PriceBooksPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="price books" />;

  const books = await listPriceBooks();
  const canWrite = can(me, PERMISSIONS.OPPORTUNITY_WRITE);

  return (
    <>
      <PageHeader
        title="Price books"
        description="Our prices for every product and service, for a period. A deal is priced from one active book."
      >
        {canWrite && <NewPriceBook />}
      </PageHeader>

      <Card>
        {books.length === 0 ? (
          <div className="py-10">
            <EmptyState title="No price books yet" description="Create one, then add the products and services it prices." />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH className="text-right">Items priced</TH>
                <TH>Valid</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {books.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <Link href={`/price-books/${b.id}`} className="text-sm font-medium hover:underline">
                      {b.name}
                    </Link>
                    {b.description && <p className="text-xs text-muted-foreground">{b.description}</p>}
                  </TD>
                  <TD className="text-right tabular-nums">{b.entryCount}</TD>
                  <TD className="text-sm">
                    {b.validFrom || b.validTo
                      ? `${b.validFrom ? formatDate(b.validFrom) : "…"} – ${b.validTo ? formatDate(b.validTo) : "…"}`
                      : "Open-ended"}
                  </TD>
                  <TD>
                    {b.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
