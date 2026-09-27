import Link from "next/link";
import { Plus } from "lucide-react";
import { listPartnerCatalogue } from "@/server/partner-catalogue";
import { ListFilters } from "@/components/list-filters";
import {
  PageHeader, Button, Card, Table, THead, TBody, TR, TH, TD, Badge, EmptyState,
} from "@/components/ui";

/**
 * What the partner sells: BabulTech's Products & Services and their own
 * company's. Theirs they add and edit here; ours are read-only, and priced in
 * our price books. Another partner's items are never listed.
 */
export default async function PortalCataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; whose?: string; productType?: string }>;
}) {
  const params = await searchParams;
  const whose = params.whose === "mine" || params.whose === "ours" ? params.whose : "";
  const { items, canAddItems } = await listPartnerCatalogue({
    search: params.search,
    whose,
    productType: params.productType,
  });

  return (
    <>
      <PageHeader
        title="Products & Services"
        description="BabulTech's products and services, and your company's own. Put any of them on a deal; yours you can add and change here."
      >
        {canAddItems && (
          <Button asChild>
            <Link href="/portal/catalogue/new">
              <Plus className="h-4 w-4" /> New product or service
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="mb-4">
        <ListFilters
          searchPlaceholder="Search name or code…"
          searchValue={params.search}
          selects={[
            {
              name: "whose",
              allLabel: "BabulTech's and yours",
              value: whose || undefined,
              options: [
                { value: "ours", label: "BabulTech's" },
                { value: "mine", label: "Yours" },
              ],
            },
            {
              name: "productType",
              allLabel: "Products and services",
              value: params.productType,
              options: [
                { value: "PRODUCT", label: "Products" },
                { value: "SERVICE", label: "Services" },
              ],
            },
          ]}
        />
      </div>

      <Card>
        {items.length === 0 ? (
          <div className="py-10">
            <EmptyState
              title="Nothing here"
              description={
                whose === "mine"
                  ? canAddItems
                    ? "You have not added any products or services of your own yet."
                    : "Items of your own belong to a partner company; please speak to your partner manager."
                  : "Nothing matches that search."
              }
            />
          </div>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH priority="secondary">Whose</TH>
                <TH priority="secondary">Status</TH>
              </TR>
            </THead>
            <TBody>
              {items.map((item) => (
                <TR key={item.id}>
                  <TD className="font-mono text-xs">{item.productCode}</TD>
                  <TD>
                    <Link href={`/portal/catalogue/${item.id}`} className="font-medium text-primary hover:underline">
                      {item.name}
                    </Link>
                  </TD>
                  <TD>
                    <span className="text-sm">{item.productType === "SERVICE" ? "Service" : "Product"}</span>
                    {item.addInTask && <Badge tone="info" className="ml-2">Sold in hours</Badge>}
                  </TD>
                  <TD priority="secondary">
                    {item.mine ? <Badge tone="success">Yours</Badge> : <span className="text-sm text-muted-foreground">BabulTech</span>}
                  </TD>
                  <TD priority="secondary">
                    {item.active ? <span className="text-sm">Active</span> : <Badge tone="warning">Inactive</Badge>}
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
