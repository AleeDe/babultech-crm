import { ProductFields } from "../product-fields";
import { getProductOptions } from "@/server/product-options";
import { createProduct, getCreateFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { RecordForm } from "@/components/record-form";

export default async function NewProductPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="creating products" />;

  const [{ taxRates }, options] = await Promise.all([getCreateFormOptions(), getProductOptions()]);


  return (
    <>
      <PageHeader
        backTo="/products"
        backLabel="Back to products"
        title="New product"
        description="What the company sells. Set its prices afterwards, in Price books on the product's page."
      />

      <div className="max-w-2xl">
        <RecordForm action={createProduct} redirectTo="/products" submitLabel="Create product">
          <ProductFields taxRates={taxRates} options={options} />
        </RecordForm>
      </div>
    </>
  );
}
