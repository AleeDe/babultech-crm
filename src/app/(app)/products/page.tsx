import { listProducts } from "@/server/crm";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState,
} from "@/components/ui";
import { formatMoney, formatPercent, humanize } from "@/lib/utils";

export default async function ProductsPage() {
  const products = await listProducts(false);

  return (
    <>
      <PageHeader
        title="Products & services"
        description="The catalogue behind quotes and invoices. Commission can be overridden per product."
      />

      <Card>
        {products.length === 0 ? (
          <EmptyState title="No products yet" description="Add your saleable products, services and subscriptions." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH>Category</TH>
                <TH>Type</TH>
                <TH>Billing</TH>
                <TH>Unit</TH>
                <TH className="text-right">Price</TH>
                <TH className="text-right">Cost</TH>
                <TH className="text-right">Commission</TH>
                <TH>Tax</TH>
              </TR>
            </THead>
            <TBody>
              {products.map((p) => (
                <TR key={p.id} className={p.active ? "" : "opacity-50"}>
                  <TD>
                    <span className="font-medium">{p.name}</span>
                    <p className="text-xs text-muted-foreground">{p.productCode}</p>
                  </TD>
                  <TD className="text-sm text-muted-foreground">{p.category ?? "—"}</TD>
                  <TD>
                    <Badge tone="neutral">{humanize(p.productType)}</Badge>
                  </TD>
                  <TD className="text-sm text-muted-foreground">{humanize(p.billingType)}</TD>
                  <TD className="text-sm text-muted-foreground">{p.unitOfMeasure ?? "—"}</TD>
                  <TD className="text-right font-medium tabular">{formatMoney(p.standardPrice)}</TD>
                  <TD className="text-right tabular text-muted-foreground">{formatMoney(p.standardCost)}</TD>
                  <TD className="text-right tabular">
                    {!p.commissionable ? (
                      <span className="text-muted-foreground">excluded</span>
                    ) : p.commissionPercent ? (
                      formatPercent(p.commissionPercent)
                    ) : (
                      <span className="text-muted-foreground">plan rate</span>
                    )}
                  </TD>
                  <TD className="text-sm text-muted-foreground">
                    {p.defaultTaxRate ? `${p.defaultTaxRate.name} ${formatPercent(p.defaultTaxRate.ratePercent, 0)}` : "—"}
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
