import { createExpense, getPayableFormOptions } from "@/server/payables";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { PageHeader, Forbidden, Input, Select, Textarea, Alert } from "@/components/ui";
import { RecordForm, FormField } from "@/components/record-form";
import { FieldHelp } from "@/components/field-help";

export default async function NewExpensePage() {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.INVOICE_WRITE)) return <Forbidden what="recording expenses" />;

  const { categories, vendors, users, projects, currencies } = await getPayableFormOptions();

  return (
    <>
      <PageHeader
        title="Record expense"
        description="Something the business paid for. On a project it can be billed on to the customer."
      />

      {categories.length === 0 && (
        <div className="mb-4">
          <Alert tone="warning">
            There are no expense categories yet. An administrator can add them under Settings.
          </Alert>
        </div>
      )}

      <div className="max-w-2xl">
        <RecordForm action={createExpense} redirectTo="/expenses" submitLabel="Record expense">
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              label="Category"
              name="categoryId"
              required
              help="What kind of cost this was — rent, utilities, hardware, software. It decides which line of the accounts it lands on, so pick the closest match rather than a general one."
            >
              <Select name="categoryId" required defaultValue="">
                <option value="" disabled>
                  Choose a category…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Date"
              name="expenseDate"
              required
              help="The day the money was actually spent, not the day you are entering it. This is what puts the cost in the right month."
            >
              <Input
                name="expenseDate"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
              />
            </FormField>

            <FormField
              label="Amount"
              name="amount"
              required
              help="The total paid, including any tax. Enter digits only — no commas or currency symbol."
            >
              <Input name="amount" type="number" step="0.01" min="0" required placeholder="12500" />
            </FormField>

            <FormField
              label="Tax"
              name="taxAmount"
              hint="Recoverable tax, if any."
              help="How much of the amount above was tax you can claim back. Leave it empty if there was none or you are unsure — it does not change what gets reimbursed."
            >
              <Input name="taxAmount" type="number" step="0.01" min="0" />
            </FormField>

            <FormField
              label="Currency"
              name="currencyCode"
              help="The currency the money was actually paid in. Leave it as PKR unless you paid a foreign supplier."
            >
              <Select name="currencyCode" defaultValue="PKR">
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Project"
              name="projectId"
              hint="Required if billing it on."
              help="Attach the cost to a project when it was incurred for one specific customer. Leave it as None for general running costs like rent or internet."
            >
              <Select name="projectId" defaultValue="">
                <option value="">None</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              label="Paid by employee"
              name="employeeUserId"
              hint="Who to reimburse."
              help="Whoever paid out of their own pocket and is owed the money back. Set this to Nobody if the company paid a supplier directly."
            >
              <Select name="employeeUserId" defaultValue={me.id}>
                <option value="">Nobody — paid to a supplier</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            </FormField>

            <FormField
              label="Or paid to supplier"
              name="vendorAccountId"
              help="Use this instead when the company paid a supplier directly, so nobody needs reimbursing. Fill in one of these two fields, not both."
            >
              <Select name="vendorAccountId" defaultValue="">
                <option value="">None</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          <FormField
              label="Description"
              name="description"
              help="What it was actually for, in a few words. This is what the approver reads, so 'Carpet for the office floor' beats 'Misc'."
            >
            <Textarea name="description" rows={2} placeholder="What it was for." />
          </FormField>

          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="reimbursable" value="true" defaultChecked />
              Reimbursable to the employee
              <FieldHelp text="Tick when the person named above paid personally and should get the money back. Untick if the company already paid it directly." />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="billableToCustomer" value="true" />
              Bill on to the customer
              <FieldHelp text="Tick to charge this cost on to the customer as well as recording it. It needs a project, because that is what it gets invoiced through." />
            </label>
          </div>
        </RecordForm>
      </div>
    </>
  );
}
