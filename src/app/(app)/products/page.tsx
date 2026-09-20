import Link from "next/link";
import { Plus } from "lucide-react";
import { listProducts } from "@/server/crm";
import { ListFilters, optionsFrom } from "@/components/list-filters";
import {
  PageHeader, Button, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState, Forbidden
} from "@/components/ui";
import { formatMoney, formatPercent, humanize } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { ExportButton } from "@/components/export-button";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; productType?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="the product catalogue" />;

  const params = await searchParams;
  const products = await listProducts(false, params);

  return (
    <>
      <PageHeader
        title="Products & services"
        description="The catalogue behind quotes and invoices. Commission can be overridden per product."
      >
        <ExportButton entity="products" params={{ search: params.search, productType: params.productType }} />
        {can(_me, PERMISSIONS.OPPORTUNITY_WRITE) && (
          <Button asChild>
            <Link href="/products/new">
              <Plus className="h-4 w-4" /> New product
            </Link>
          </Button>
        )}
      </PageHeader>

      <ListFilters
        searchPlaceholder="Search name, code or category…"
        searchValue={params.search}
        selects={[
          {
            name: "productType",
            allLabel: "All types",
            value: params.productType,
            options: optionsFrom(["PRODUCT", "SERVICE", "SUBSCRIPTION"]),
          },
        ]}
      />

      <Card>
        {products.length === 0 ? (
          <EmptyState title="No products yet" description="Add your saleable products, services and subscriptions." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH priority="tertiary">Category</TH>
                <TH priority="secondary">Type</TH>
                <TH className="text-right" priority="tertiary">Commission</TH>
                <TH priority="tertiary">Tax</TH>
              </TR>
            </THead>
            <TBody>
              {products.map((p) => (
                <TR key={p.id} className={p.active ? "" : "opacity-50"}>
                  <TD>
                    <Link href={`/products/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{p.productCode}</p>
                  </TD>
                  <TD priority="tertiary" className="text-sm text-muted-foreground">{p.category ?? "—"}</TD>
                  <TD priority="secondary">
                    <Badge tone="neutral">{humanize(p.productType)}</Badge>
                  </TD>
                  <TD priority="tertiary" className="text-right tabular">
                    {!p.commissionable ? (
                      <span className="text-muted-foreground">excluded</span>
                    ) : p.commissionPercent ? (
                      formatPercent(p.commissionPercent)
                    ) : (
                      <span className="text-muted-foreground">plan rate</span>
                    )}
                  </TD>
                  <TD priority="tertiary" className="text-sm text-muted-foreground">
                    {p.defaultTaxRate ? `${p.defaultTaxRate?.name} ${formatPercent(p.defaultTaxRate?.ratePercent, 0)}` : "—"}
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
