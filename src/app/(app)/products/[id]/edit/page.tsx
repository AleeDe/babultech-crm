import { ProductFields } from "../../product-fields";
import { getProductOptions } from "@/server/product-options";
import { notFound } from "next/navigation";
import { getProduct, updateProduct, getCreateFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden } from "@/components/ui";
import { RecordForm } from "@/components/record-form";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="editing products" />;

  const { id } = await params;
  const [product, { taxRates }, options] = await Promise.all([getProduct(id), getCreateFormOptions(), getProductOptions()]);
  if (!product) notFound();

  // updateProduct takes the id first, so it is bound here rather than passed
  // through the form as a hidden field the client could rewrite.
  const save = updateProduct.bind(null, id);

  return (
    <>
      <PageHeader
        backTo={`/products/${id}`}
        backLabel="Back to the product"
        title={`Edit ${product.name}`} description={product.productCode} />

      <div className="max-w-2xl">
        <RecordForm action={save} redirectTo={`/products/${id}`} submitLabel="Save changes">
          <ProductFields defaults={product} taxRates={taxRates} options={options} />
        </RecordForm>
      </div>
    </>
  );
}
