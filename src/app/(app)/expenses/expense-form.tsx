"use client";

import { useState } from "react";
import { Input, Select, Textarea, Alert } from "@/components/ui";
import { RecordLookup } from "@/components/record-lookup";
import { RecordForm, FormField } from "@/components/record-form";
import { FieldHelp } from "@/components/field-help";
import { SelectWithAdd } from "@/components/select-with-add";

export interface ExpenseFormOptions {
  categories: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  users: { id: string; fullName: string }[];
  projects: { id: string; name: string }[];
  currencies: { code: string; name: string }[];
}

export interface ExpenseDefaults {
  categoryId?: string | null;
  expenseDate?: string | null;
  amount?: string | number | null;
  taxAmount?: string | number | null;
  currencyCode?: string | null;
  description?: string | null;
  employeeUserId?: string | null;
  vendorAccountId?: string | null;
  projectId?: string | null;
  billableToCustomer?: boolean;
  reimbursable?: boolean;
}

type Result =
  | { ok: true; data?: { id: string } }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/**
 * The expense form, shared by recording a new one and correcting an existing one.
 *
 * One component rather than two near-identical pages: the validation rules that
 * make an expense coherent — who is owed the money, whether it can be recharged
 * — are the same whichever direction you arrive from, and a second copy is how
 * a rule ends up enforced on create and quietly missing on edit.
 *
 * `action` is already bound to the record id by the edit page, so this does not
 * need to know which of the two it is doing.
 */
export function ExpenseForm({
  action,
  onCreateCategory,
  options,
  defaults,
  submitLabel,
  redirectTo,
  /** Shown above the form when something about the record limits the edit. */
  notice,
}: {
  action: (values: never) => Promise<Result>;
  /** Server action passed down so the category picker can add one inline. */
  onCreateCategory: (input: { name: string; channel?: string | null }) => Promise<
    | { ok: true; data?: { id: string; name: string } }
    | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }
  >;
  options: ExpenseFormOptions;
  defaults?: ExpenseDefaults;
  submitLabel: string;
  redirectTo: string;
  notice?: string;
}) {
  const d = defaults ?? {};

  // Held in state so the hints can react to what is currently ticked, rather
  // than the reader discovering the rule only when the server refuses.
  const [reimbursable, setReimbursable] = useState(d.reimbursable ?? true);
  const [billable, setBillable] = useState(d.billableToCustomer ?? false);
  const [projectId, setProjectId] = useState(d.projectId ?? "");
  const [employeeUserId, setEmployeeUserId] = useState(d.employeeUserId ?? "");

  return (
    <>
      {notice && (
        <div className="mb-4">
          <Alert tone="warning">{notice}</Alert>
        </div>
      )}

      <RecordForm action={action} redirectTo={redirectTo} submitLabel={submitLabel}>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Category"
            name="categoryId"
            required
            help="What kind of cost this was - rent, utilities, hardware, software. It decides which line of the accounts it lands on, so pick the closest match rather than a general one. Add one with + if it is not listed."
          >
            <SelectWithAdd
              name="categoryId"
              required
              options={options.categories}
              defaultValue={d.categoryId ?? ""}
              placeholder="Choose a category…"
              addLabel="Add an expense category"
              onCreate={onCreateCategory}
            />
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
              defaultValue={
                d.expenseDate
                  ? String(d.expenseDate).slice(0, 10)
                  : new Date().toISOString().slice(0, 10)
              }
            />
          </FormField>

          <FormField
            label="Amount"
            name="amount"
            required
            help="The total paid, including any tax. Enter digits only - no commas or currency symbol."
          >
            <Input
              name="amount"
              type="number"
              step="0.01"
              min="0"
              required
              placeholder="12500"
              defaultValue={d.amount != null ? String(d.amount) : ""}
            />
          </FormField>

          <FormField
            label="Tax"
            name="taxAmount"
            hint="Recoverable tax, if any."
            help="How much of the amount above was tax you can claim back. Leave it empty if there was none or you are unsure - it does not change what gets reimbursed."
          >
            <Input
              name="taxAmount"
              type="number"
              step="0.01"
              min="0"
              defaultValue={d.taxAmount != null ? String(d.taxAmount) : ""}
            />
          </FormField>

          <FormField
            label="Currency"
            name="currencyCode"
            help="The currency the money was actually paid in. Leave it as PKR unless you paid a foreign supplier."
          >
            <Select name="currencyCode" defaultValue={d.currencyCode ?? "PKR"}>
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} - {c.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField
            label="Project"
            name="projectId"
            hint={billable ? "Required - this is what it gets billed through." : "Required if billing it on."}
            help="Attach the cost to a project when it was incurred for one specific customer. Leave it as None for general running costs like rent or internet."
          >
            <RecordLookup entity="project" name="projectId" value={projectId} onChange={(id) => setProjectId((id ?? ""))} emptyLabel="None" />
          </FormField>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Who paid from their own pocket"
            name="employeeUserId"
            hint={reimbursable ? "They get this money back." : "Optional - nobody is out of pocket."}
            help="The person who spent their own money and is owed it back. Set this to Nobody if the company paid directly, and untick paying it back below."
          >
            <RecordLookup entity="user" name="employeeUserId" value={employeeUserId} onChange={(id) => setEmployeeUserId((id ?? ""))} emptyLabel="Nobody - the company paid directly" />
          </FormField>

          <FormField
            label="Or the company paid this supplier"
            name="vendorAccountId"
            hint="Optional."
            help="Name the supplier only if it is one you keep records for. Petty cash, a rickshaw or tea for a meeting is a real cost with no supplier worth recording, so leaving this blank is fine."
          >
            <Select name="vendorAccountId" defaultValue={d.vendorAccountId ?? ""}>
              <option value="">None</option>
              {options.vendors.map((v) => (
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
          <Textarea
            name="description"
            rows={2}
            placeholder="What it was for."
            defaultValue={d.description ?? ""}
          />
        </FormField>

        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="reimbursable"
              value="true"
              checked={reimbursable}
              onChange={(e) => setReimbursable(e.target.checked)}
            />
            Pay this money back to them
            <FieldHelp text="Leave this ticked when someone paid from their own pocket - it is what puts the claim on the list of money the company owes. Untick it if the company already paid directly and nobody is out of pocket." />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="billableToCustomer"
              value="true"
              checked={billable}
              onChange={(e) => setBillable(e.target.checked)}
            />
            Bill on to the customer
            <FieldHelp text="Tick to charge this cost on to the customer as well as recording it. It needs a project, because that is what it gets invoiced through." />
          </label>
        </div>
      </RecordForm>
    </>
  );
}
