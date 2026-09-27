import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { getPartnerItem } from "@/server/partner-catalogue";
import {
  PageHeader, Badge, Button, Card, CardHeader, CardTitle, CardContent,
  DetailRow, Table, THead, TBody, TR, TH, TD, EmptyState,
} from "@/components/ui";
import { RichText } from "@/components/rich-text";
import { formatDate, formatMoney } from "@/lib/utils";

/**
 * One product or service the partner may sell. Their own they can edit;
 * BabulTech's is read-only, with its prices in our books.
 */
export default async function PortalItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getPartnerItem(id);
  if (!item) notFound();

  const isService = item.productType === "SERVICE";

  return (
    <>
      <PageHeader
        backTo="/portal/catalogue"
        backLabel="Back to products & services"
        title={item.name}
        description={item.productCode}
      >
        <Badge tone={isService ? "info" : "neutral"}>{isService ? "Service" : "Product"}</Badge>
        {item.addInTask && <Badge tone="success">Sold in hours</Badge>}
        {!item.active && <Badge tone="warning">Inactive</Badge>}
        {item.mine && (
          <Button asChild variant="outline">
            <Link href={`/portal/catalogue/${item.id}/edit`}>
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
                BabulTech&apos;s price books that include it. A deal takes its price from the book it
                uses, and every price can still be changed on the deal.
              </p>
            </CardHeader>
            {item.prices.length === 0 ? (
              <CardContent>
                <EmptyState
                  title="Not in any price book"
                  description={
                    item.mine
                      ? "Your own items are priced on each deal: put it on a deal and type in its price."
                      : "It can still be put on a deal, with its price typed in."
                  }
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
                        <TD className="text-sm font-medium">{p.bookName}</TD>
                        <TD className="text-right tabular-nums">{Number(p.quantity)}</TD>
                        <TD className="text-right tabular-nums">{formatMoney(p.rate)}</TD>
                        <TD className="text-right font-medium tabular-nums">{formatMoney(p.total)}</TD>
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
            <DetailRow label="Code" help="Issued automatically. P- for products, S- for services.">
              <span className="font-mono">{item.productCode}</span>
            </DetailRow>
            <DetailRow label="Type">{isService ? "Service" : "Product"}</DetailRow>
            {isService && (
              <DetailRow
                label="Sold in hours"
                help="If yes, its quantity on a deal is a number of hours, and those hours become a task on the delivery project when the deal is won."
              >
                {item.addInTask ? "Yes" : "No"}
              </DetailRow>
            )}
            <DetailRow label="Whose">{item.mine ? "Your company's" : "BabulTech's - read-only"}</DetailRow>
            <DetailRow label="Status">{item.active ? "Active" : "Inactive"}</DetailRow>
            <DetailRow label="Added">{formatDate(item.createdAt)}</DetailRow>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
