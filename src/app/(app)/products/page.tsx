import Link from "next/link";
import { Plus } from "lucide-react";
import { listProductsServices } from "@/server/products-services";
import { ListFilters } from "@/components/list-filters";
import {
  PageHeader, Button, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState, Forbidden, StatTile,
} from "@/components/ui";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";

export default async function ProductsServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; productType?: string; active?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_READ)) return <Forbidden what="products and services" />;

  const params = await searchParams;
  const items = await listProductsServices(params);

  const products = items.filter((i) => i.productType === "PRODUCT").length;
  const services = items.length - products;
  const tasked = items.filter((i) => i.addInTask).length;

  return (
    <>
      <PageHeader
        title="Products & Services"
        description="Everything we and our partners sell. Prices are set in price books; a service marked Add in Task is sold in hours and becomes project work."
      >
        {can(me, PERMISSIONS.OPPORTUNITY_WRITE) && (
          <Button asChild>
            <Link href="/products/new">
              <Plus className="h-4 w-4" /> New product or service
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Products" value={String(products)} href="/products?productType=PRODUCT" />
        <StatTile label="Services" value={String(services)} href="/products?productType=SERVICE" />
        <StatTile
          label="Add in Task"
          value={String(tasked)}
          sublabel="Sold in hours, become project tasks"
          tone="info"
        />
      </div>

      <div className="mt-6">
        <ListFilters
          searchPlaceholder="Search name or code…"
          searchValue={params.search}
          selects={[
            {
              name: "productType",
              allLabel: "Products and services",
              value: params.productType,
              options: [
                { value: "PRODUCT", label: "Products" },
                { value: "SERVICE", label: "Services" },
              ],
            },
            {
              name: "active",
              allLabel: "Active or not",
              value: params.active,
              options: [
                { value: "yes", label: "Active" },
                { value: "no", label: "Inactive" },
              ],
            },
          ]}
        />
      </div>

      <Card>
        {items.length === 0 ? (
          <div className="py-10">
            <EmptyState title="Nothing matches" description="Clear the filters, or add a product or service." />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH priority="secondary">Add in Task</TH>
                <TH priority="secondary">Owner</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD className="font-mono text-sm">{i.productCode}</TD>
                  <TD>
                    <Link href={`/products/${i.id}`} className="text-sm font-medium hover:underline">
                      {i.name}
                    </Link>
                  </TD>
                  <TD>
                    <Badge tone={i.productType === "SERVICE" ? "info" : "neutral"}>
                      {i.productType === "SERVICE" ? "Service" : "Product"}
                    </Badge>
                  </TD>
                  <TD priority="secondary" className="text-sm">
                    {i.productType === "SERVICE" ? (i.addInTask ? "Yes — hours" : "No") : "—"}
                  </TD>
                  <TD priority="secondary" className="text-sm">{i.owner?.name ?? "—"}</TD>
                  <TD>
                    {i.active ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Inactive</Badge>}
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
