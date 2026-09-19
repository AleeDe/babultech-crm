"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Textarea,
  Table, THead, TBody, TR, TH, TD,
} from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";
import { formatDate, formatMoney } from "@/lib/utils";
import { savePriceBook, deletePriceBook, type PriceBook } from "@/server/price-books";

const COSTS = [
  ["licenseCost", "License cost"],
  ["maintenanceCost", "Maintenance cost"],
  ["cloudCost", "Cloud cost"],
  ["aiCost", "AI cost"],
] as const;

const bookTotal = (b: PriceBook) =>
  Number(b.licenseCost) + Number(b.maintenanceCost) + Number(b.cloudCost) + Number(b.aiCost);

/**
 * A product's price books. Each deal picks one; its costs are copied onto the
 * deal, so editing a book here only affects deals priced from it afterwards.
 */
export function PriceBooksPanel({
  productId,
  books,
  currencies,
  canEdit,
}: {
  productId: string;
  books: PriceBook[];
  currencies: { code: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [editing, setEditing] = useState<PriceBook | "new" | null>(null);

  const book = editing === "new" ? null : editing;

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    const get = (k: string) => String(fd.get(k) ?? "");
    setFormError(null);
    start(async () => {
      const result = await savePriceBook({
        id: book?.id ?? null,
        productId,
        name: get("name"),
        description: get("description"),
        currencyCode: get("currencyCode") || "PKR",
        licenseCost: get("licenseCost"),
        maintenanceCost: get("maintenanceCost"),
        cloudCost: get("cloudCost"),
        aiCost: get("aiCost"),
        validFrom: get("validFrom"),
        validTo: get("validTo"),
        active: fd.get("active") === "on",
      });
      if (result.ok) {
        setEditing(null);
        router.refresh();
      } else setFormError(result.error);
    });
  }

  function remove(b: PriceBook) {
    if (!window.confirm(`Delete the "${b.name}" price book? Deals already priced from it keep their prices.`)) return;
    setError(null);
    start(async () => {
      const result = await deletePriceBook(b.id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <Card className="mt-6">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>Price books</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            The priced offers a deal can choose from, such as Standard and Premium, or this year&apos;s rates.
          </p>
        </div>
        {canEdit && (
          <Button variant="outline" size="sm" onClick={() => { setFormError(null); setEditing("new"); }}>
            <Plus className="h-4 w-4" /> Add price book
          </Button>
        )}
      </CardHeader>
      <CardContent className="px-0">
        {error && <div className="px-6 pb-3"><Alert tone="danger">{error}</Alert></div>}
        {books.length === 0 ? (
          <p className="px-6 text-sm text-muted-foreground">
            No price books yet. Add one so deals can be priced from this product.
          </p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Price book</TH>
                {COSTS.map(([, label]) => <TH key={label} className="text-right" priority="secondary">{label}</TH>)}
                <TH className="text-right">Total</TH>
                <TH priority="tertiary">Valid</TH>
                {canEdit && <TH className="w-20" />}
              </TR>
            </THead>
            <TBody>
              {books.map((b) => (
                <TR key={b.id} className={b.active ? undefined : "opacity-60"}>
                  <TD>
                    <span className="font-medium">{b.name}</span>{" "}
                    {!b.active && <Badge tone="neutral">Inactive</Badge>}
                    {b.description && <p className="max-w-[260px] truncate text-xs text-muted-foreground">{b.description}</p>}
                  </TD>
                  {COSTS.map(([key]) => (
                    <TD key={key} className="text-right tabular" priority="secondary">{formatMoney(b[key], b.currencyCode)}</TD>
                  ))}
                  <TD className="text-right font-medium tabular">{formatMoney(bookTotal(b), b.currencyCode)}</TD>
                  <TD priority="tertiary" className="whitespace-nowrap text-sm text-muted-foreground">
                    {b.validFrom || b.validTo
                      ? `${b.validFrom ? formatDate(b.validFrom) : "…"} – ${b.validTo ? formatDate(b.validTo) : "…"}`
                      : "Always"}
                  </TD>
                  {canEdit && (
                    <TD>
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" title="Edit" aria-label={`Edit ${b.name}`} onClick={() => { setFormError(null); setEditing(b); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Delete" aria-label={`Delete ${b.name}`} disabled={pending} onClick={() => remove(b)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => { if (!open) setEditing(null); }}
        title={book ? `Edit ${book.name}` : "New price book"}
        description="Deals copy these costs when they pick this book."
      >
        <form onSubmit={onSubmit} className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required help="How sales will recognise it, e.g. Standard, Premium or 2026 pricing.">
              <Input name="name" required maxLength={100} defaultValue={book?.name ?? ""} placeholder="Standard" />
            </Field>
            <Field label="Currency" required>
              <Select name="currencyCode" defaultValue={book?.currencyCode ?? "PKR"}>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} - {c.name}</option>)}
              </Select>
            </Field>
            {COSTS.map(([key, label]) => (
              <Field key={key} label={label}>
                <Input name={key} type="number" step="0.01" min="0" defaultValue={book ? Number(book[key]).toString() : "0"} />
              </Field>
            ))}
            <Field label="Valid from" hint="Optional.">
              <Input name="validFrom" type="date" defaultValue={book?.validFrom ?? ""} />
            </Field>
            <Field label="Valid to" hint="Optional.">
              <Input name="validTo" type="date" defaultValue={book?.validTo ?? ""} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Description">
                <Textarea name="description" rows={2} defaultValue={book?.description ?? ""} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="active" defaultChecked={book?.active ?? true} className="h-4 w-4 rounded border-input" />
              Active (offered on new deals)
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending ? "Saving…" : book ? "Save changes" : "Add price book"}</Button>
          </div>
        </form>
      </FormDialog>
    </Card>
  );
}
