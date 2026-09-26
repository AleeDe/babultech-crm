import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { ProductServiceForm } from "../product-service-form";

export default async function NewProductServicePage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="products and services" />;

  return (
    <>
      <PageHeader
        backTo="/products"
        backLabel="Back to products & services"
        title="New product or service"
        description="Its code is issued when you save. Prices are set in a price book, not here."
      />
      <ProductServiceForm />
    </>
  );
}
