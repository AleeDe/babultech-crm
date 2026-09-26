import { notFound } from "next/navigation";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { getProductService } from "@/server/products-services";
import { PageHeader, Forbidden } from "@/components/ui";
import { ProductServiceForm } from "../../product-service-form";

export default async function EditProductServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="products and services" />;

  const { id } = await params;
  const item = await getProductService(id);
  if (!item) notFound();

  return (
    <>
      <PageHeader
        backTo={`/products/${id}`}
        backLabel={`Back to ${item.name}`}
        title={`Edit ${item.name}`}
        description={item.productCode}
      />
      <ProductServiceForm defaults={item} typeLocked={item.typeLocked} />
    </>
  );
}
