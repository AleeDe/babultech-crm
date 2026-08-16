import { createProduct, getCreateFormOptions } from "@/server/crm";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Input, Select, Textarea } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";

export default async function NewProductPage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.OPPORTUNITY_WRITE)) return <Forbidden what="creating products" />;

  const { taxRates } = await getCreateFormOptions();


  return (
    <>
      <PageHeader
        title="New product"
        description="Quote and invoice lines price from this catalogue."
      />

      <div className="max-w-2xl">
        <RecordForm action={createProduct} redirectTo="/products" submitLabel="Create product">
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField
                  label="Code"
                  name="productCode"
                  required
                  hint="Your own reference, e.g. SW-CRM-002."
                 
                >
                  <Input name="productCode" required placeholder="SW-CRM-002" />
                </FormField>

                <FormField label="Category" name="category">
                  <Input name="category" placeholder="Software" />
                </FormField>
              </div>

              <FormField label="Name" name="name" required>
                <Input name="name" required placeholder="BabulTech CRM" />
              </FormField>

              <div className="grid gap-5 sm:grid-cols-2">
                <FormField label="Type" name="productType" required>
                  <Select name="productType" required defaultValue="SERVICE">
                    <option value="PRODUCT">Product</option>
                    <option value="SERVICE">Service</option>
                    <option value="SUBSCRIPTION">Subscription</option>
                  </Select>
                </FormField>

                <FormField
                  label="Billing"
                  name="billingType"
                  required
                  hint="How it is charged for."
                 
                >
                  <Select name="billingType" required defaultValue="FIXED">
                    <option value="FIXED">Fixed</option>
                    <option value="HOURLY">Hourly</option>
                    <option value="RETAINER">Retainer</option>
                    <option value="MILESTONE">Milestone</option>
                    <option value="ANNUAL">Annual</option>
                  </Select>
                </FormField>

                <FormField label="Standard price" name="standardPrice">
                  <Input name="standardPrice" type="number" step="0.01" min="0" placeholder="950000" />
                </FormField>

                <FormField
                  label="Standard cost"
                  name="standardCost"
                  hint="What it costs you. Used for margin."
                 
                >
                  <Input name="standardCost" type="number" step="0.01" min="0" placeholder="310000" />
                </FormField>

                <FormField label="Unit" name="unitOfMeasure">
                  <Input name="unitOfMeasure" placeholder="Licence" />
                </FormField>

                <FormField label="Default tax rate" name="defaultTaxRateId">
                  <Select name="defaultTaxRateId" defaultValue="">
                    <option value="">None</option>
                    {taxRates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.ratePercent}%)
                      </option>
                    ))}
                  </Select>
                </FormField>

                <FormField
                  label="Commission %"
                  name="commissionPercent"
                  hint="What a partner earns on it."
                 
                >
                  <Input name="commissionPercent" type="number" step="0.01" min="0" max="100" placeholder="10" />
                </FormField>
              </div>

              <FormField label="Description" name="description">
                <Textarea name="description" rows={3} placeholder="What the customer is buying." />
              </FormField>

              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="commissionable" value="true" defaultChecked />
                  Commissionable
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" value="true" defaultChecked />
                  Active — available to quote
                </label>
              </div>
        </RecordForm>
      </div>
    </>
  );
}
