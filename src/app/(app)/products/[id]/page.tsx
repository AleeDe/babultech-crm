import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getProductService } from "@/server/products-services";
import {
  PageHeader, Forbidden, Badge, Button, Card, CardHeader, CardTitle, CardContent,
  DetailRow, Table, THead, TBody, TR, TH, TD, EmptyState,
} from "@/components/ui";
import { RichText } from "@/components/rich-text";
import { Money } from "@/components/money";
import { formatDate } from "@/lib/utils";
import { ProductActiveToggle } from "./active-toggle";

export default async function ProductServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="products and services" />;

  const { id } = await params;
  const item = await getProductService(id);
  if (!item) notFound();

  const canWrite = can(me, PERMISSIONS.OPPORTUNITY_WRITE);
  const isService = item.productType === "SERVICE";

  return (
    <>
      <PageHeader
        backTo="/products"
        backLabel="Back to products & services"
        title={item.name}
        description={item.productCode}
      >
        <Badge tone={isService ? "info" : "neutral"}>{isService ? "Service" : "Product"}</Badge>
        {item.addInTask && <Badge tone="success">Add in Task</Badge>}
        {!item.active && <Badge tone="warning">Inactive</Badge>}
        {canWrite && <ProductActiveToggle productId={item.id} active={item.active} />}
        {canWrite && (
          <Button asChild variant="outline">
            <Link href={`/products/${item.id}/edit`}>
              <Pencil className="h-4 w-4" /> Edit
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <RichText value={item.description} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Where it is priced</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                The price books that include this. A deal takes its price from whichever book it uses.
              </p>
            </CardHeader>
            {item.prices.length === 0 ? (
              <CardContent>
                <EmptyState
                  title="Not in any price book yet"
                  description="It can still be put on a deal, with its price typed in. Add it to a price book to have deals priced automatically."
                />
              </CardContent>
            ) : (
              <CardContent className="px-0">
                <Table>
                  <THead>
                    <TR>
                      <TH>Price book</TH>
                      <TH className="text-right">{isService && item.addInTask ? "Hours" : "Quantity"}</TH>
                      <TH className="text-right">Rate</TH>
                      <TH className="text-right">Total</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {item.prices.map((p) => (
                      <TR key={p.bookId}>
                        <TD>
                          <Link href={`/price-books/${p.bookId}`} className="text-sm font-medium hover:underline">
                            {p.bookName}
                          </Link>
                          {!p.bookActive && <Badge tone="neutral" className="ml-2">Inactive</Badge>}
                        </TD>
                        <TD className="text-right tabular-nums">{Number(p.quantity)}</TD>
                        <TD className="text-right"><Money value={p.rate} /></TD>
                        <TD className="text-right font-medium"><Money value={p.total} /></TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardContent>
            )}
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <DetailRow
              label="Code"
              help="Issued automatically. P- for products, S- for services."
            >
              <span className="font-mono">{item.productCode}</span>
            </DetailRow>
            <DetailRow label="Type">{isService ? "Service" : "Product"}</DetailRow>
            {isService && (
              <DetailRow
                label="Add in Task"
                help="If yes, its quantity on a deal is a number of hours, and those hours become a project task when the deal is won."
              >
                {item.addInTask ? "Yes — sold in hours, becomes a project task" : "No"}
              </DetailRow>
            )}
            <DetailRow label="Owner">
              {item.owner ? (
                <Link href={`/accounts/${item.owner.id}`} className="text-primary hover:underline">
                  {item.owner.name}
                </Link>
              ) : "—"}
            </DetailRow>
            <DetailRow label="Status">{item.active ? "Active" : "Inactive"}</DetailRow>
            <DetailRow label="Added">{formatDate(item.createdAt)}</DetailRow>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
