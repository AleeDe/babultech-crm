"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createInvoice, updateInvoice } from "@/server/billing";
import {
  Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Select, Textarea, Alert,
} from "@/components/ui";
import {
  LineEditor, newLine, documentTotals,
  type LineRow, type ProductOption, type TaxRateOption,
} from "@/components/line-editor";
import { formatMoney } from "@/lib/utils";

export interface InvoiceFormOptions {
  accounts: { id: string; name: string }[];
  contacts: { id: string; firstName: string; lastName: string; accountId: string | null }[];
  projects: {
    id: string;
    name: string;
    projectNumber: string;
    accountId: string;
    contractId: string | null;
    milestones: { id: string; name: string; invoicedAt: string | null; status: string }[];
  }[];
  contracts: { id: string; contractNumber: string; name: string; accountId: string }[];
  products: ProductOption[];
  taxRates: TaxRateOption[];
  currencies: { code: string; name: string }[];
}

export interface InvoiceDefaults {
  id: string;
  invoiceNumber: string;
  accountId: string;
  contactId: string | null;
  projectId: string | null;
  contractId: string | null;
  milestoneId: string | null;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  paymentTermsDays: number | null;
  notes: string | null;
  lines: {
    productId: string | null;
    description: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string | null;
    taxRateId: string | null;
  }[];
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let importSeq = 0;

export function InvoiceForm({
  options,
  defaults,
  lockedAccountId,
}: {
  options: InvoiceFormOptions;
  defaults?: InvoiceDefaults;
  lockedAccountId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [accountId, setAccountId] = useState(defaults?.accountId ?? lockedAccountId ?? "");
  const [projectId, setProjectId] = useState(defaults?.projectId ?? "");
  const [currency, setCurrency] = useState(defaults?.currencyCode ?? "PKR");
  const [lines, setLines] = useState<LineRow[]>(
    defaults?.lines.length
      ? defaults.lines.map((l) => {
          importSeq += 1;
          return {
            key: `d${importSeq}`,
            productId: l.productId ?? "",
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountPercent: l.discountPercent ?? "",
            taxRateId: l.taxRateId ?? "",
          };
        })
      : [newLine()],
  );

  const editing = Boolean(defaults);
  const totals = useMemo(() => documentTotals(lines, options.taxRates), [lines, options.taxRates]);

  const accountContacts = useMemo(
    () => options.contacts.filter((c) => c.accountId === accountId),
    [options.contacts, accountId],
  );
  const accountProjects = useMemo(
    () => options.projects.filter((p) => p.accountId === accountId),
    [options.projects, accountId],
  );
  const accountContracts = useMemo(
    () => options.contracts.filter((c) => c.accountId === accountId),
    [options.contracts, accountId],
  );
  // Only milestones that bill and have not already been billed.
  const billableMilestones = useMemo(
    () =>
      options.projects
        .find((p) => p.id === projectId)
        ?.milestones?.filter((m) => !m.invoicedAt) ?? [],
    [options.projects, projectId],
  );

  // A submit HANDLER rather than <form action={...}>. React resets a form after
  // an action completes, and every field here is uncontrolled (defaultValue), so
  // with `action` a rejected submit cleared everything the user had typed and
  // made them fill the whole form in again to correct one field.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    setError(null);
    setFieldErrors({});

    const get = (k: string) => {
      const v = formData.get(k);
      return v === null || v === "" ? null : String(v);
    };

    const usable = lines.filter((l) => l.description.trim() && Number(l.quantity) > 0);
    if (usable.length === 0) {
      setError("An invoice needs at least one line with a description and a quantity.");
      return;
    }

    const input = {
      accountId,
      contactId: get("contactId"),
      projectId: projectId || null,
      contractId: get("contractId"),
      milestoneId: get("milestoneId"),
      invoiceDate: get("invoiceDate"),
      dueDate: get("dueDate"),
      currencyCode: currency,
      paymentTermsDays: get("paymentTermsDays"),
      notes: get("notes"),
      lines: usable.map((l) => ({
        productId: l.productId || null,
        projectId: projectId || null,
        milestoneId: null,
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice || "0",
        discountPercent: l.discountPercent || null,
        taxRateId: l.taxRateId || null,
      })),
    } as never;

    startTransition(async () => {
      const result = defaults
        ? await updateInvoice(defaults.id, input)
        : await createInvoice(input);

      if (result.ok) {
        router.push(`/invoices/${result.data.id}`);
        router.refresh();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors ?? {});
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Header</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Customer" required error={fieldErrors.accountId?.[0]}
            help="The account being billed.">
            <Select
              name="accountId"
              required
              value={accountId}
              disabled={editing || Boolean(lockedAccountId)}
              onChange={(e) => { setAccountId(e.target.value); setProjectId(""); }}
            >
              <option value="">Select a customer…</option>
              {options.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Bill to" hint={accountId ? undefined : "Pick a customer first."}
            help="The contact who receives the invoice. Usually accounts payable rather than the person you sold to.">
            <Select name="contactId" defaultValue={defaults?.contactId ?? ""} disabled={!accountId}>
              <option value="">None</option>
              {accountContacts.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Currency" required
            help="The currency being billed in. It must match the customer's expectation or the payment will not reconcile.">
            <Select name="currencyCode" required value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {options.currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code} - {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Payment terms (days)"
            help="How many days the customer has to pay. Sets the due date above.">
            <Input name="paymentTermsDays" type="number" min="0" defaultValue={defaults?.paymentTermsDays ?? 30} />
          </Field>

          <Field
            label="Project"
            hint="Links the invoice to delivery - and is how partner commission finds the deal."
            help="The project this invoice covers, if it is project work. Lets you see billed against budget."
          >
            <Select
              name="projectId"
              value={projectId}
              disabled={!accountId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">None</option>
              {accountProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.projectNumber} - {p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Contract"
            help="The contract being invoiced under, for recurring or milestone billing.">
            <Select name="contractId" defaultValue={defaults?.contractId ?? ""} disabled={!accountId}>
              <option value="">None</option>
              {accountContracts.map((c) => (
                <option key={c.id} value={c.id}>{c.contractNumber} - {c.name}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Milestone"
            hint={projectId ? "Stamped as invoiced on send, so it cannot be billed twice." : "Pick a project first."}
            help="The specific milestone being claimed, when billing against a plan rather than a period."
          >
            <Select name="milestoneId" defaultValue={defaults?.milestoneId ?? ""} disabled={!projectId}>
              <option value="">None</option>
              {billableMilestones.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <div />

          <Field label="Invoice date" required
            help="The date the invoice is issued. Payment terms count from here.">
            <Input
              name="invoiceDate"
              type="date"
              required
              defaultValue={dateInput(defaults?.invoiceDate ?? null) || inDays(0)}
            />
          </Field>
          <Field label="Due date" required error={fieldErrors.dueDate?.[0]}
            help="When payment is expected. Calculated from the terms below, but you can override it.">
            <Input
              name="dueDate"
              type="date"
              required
              defaultValue={dateInput(defaults?.dueDate ?? null) || inDays(30)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <LineEditor
            lines={lines}
            onChange={setLines}
            products={options.products}
            taxRates={options.taxRates}
            currency={currency}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea name="notes" rows={3} defaultValue={defaults?.notes ?? ""} />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Invoice total <span className="font-semibold text-foreground">{formatMoney(totals.total, currency)}</span>
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : editing ? "Save invoice" : "Create draft invoice"}
          </Button>
        </div>
      </div>
    </form>
  );
}
