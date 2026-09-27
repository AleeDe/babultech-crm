"use client";

import { useMemo } from "react";
import { Plus, Trash2, BookMarked, ListChecks } from "lucide-react";
import { Button, Field, Input, Select } from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { Money } from "@/components/money";
import type { BookEntryPrice, PricingOption } from "@/server/opportunity-lines";

/**
 * Products and services priced from a price book: the editor a deal and its
 * quotes share.
 *
 * A quote is priced exactly as its deal is - the same book, the same four
 * costs, the same discount and tax, the same arithmetic - and accepting one
 * puts its lines on the deal, so the two must never be able to describe a line
 * differently. The deal saves its lines through save_opportunity_lines, a quote
 * with the rest of the quote. Neither keeps this file's arithmetic: the
 * database works each total out as a generated column, and that is what is
 * stored. What is here is what the person sees while typing.
 */

export type PricedRow = {
  key: string;
  /** The saved line this row edits, if any. */
  id: string | null;
  productId: string;
  priceBookEntryId: string | null;
  /** What the customer reads on a quote. Deals do not show it. */
  description: string;
  quantity: string;
  unitPrice: string;
  licenseCost: string;
  maintenanceCost: string;
  cloudCost: string;
  aiCost: string;
  discountPercent: string;
  taxRateId: string;
};

export interface PricingCatalogue {
  books: { id: string; name: string; validFrom: string | null; validTo: string | null }[];
  /** Prices in every active book, keyed by book, so choosing one needs no round trip. */
  pricesByBook: Record<string, BookEntryPrice[]>;
  products: PricingOption[];
  taxRates: { id: string; name: string; ratePercent: string }[];
}

/** A saved line, from a deal or a quote, in the shape the editor takes. */
export interface SavedLine {
  id?: string | null;
  productId: string | null;
  priceBookEntryId: string | null;
  description?: string | null;
  quantity: string | number;
  unitPrice: string | number;
  licenseCost: string | number;
  maintenanceCost: string | number;
  cloudCost: string | number;
  aiCost: string | number;
  discountPercent: string | number | null;
  taxRateId: string | null;
}

export const COSTS = [
  { key: "licenseCost", label: "License cost" },
  { key: "maintenanceCost", label: "Maintenance cost" },
  { key: "cloudCost", label: "Cloud cost" },
  { key: "aiCost", label: "AI cost" },
] as const;

let seq = 0;
export const nextRowKey = () => `row-${++seq}`;

/** Blank rather than "0" when the value is zero, so an unpriced field reads as unpriced. */
export const blankIfZero = (v: string | number | null | undefined) =>
  v === null || v === undefined || Number(v) === 0 ? "" : String(Number(v));

/** A form value as a number, blank being nothing. */
export const num = (v: string) => Number(v || 0);

/**
 * The agreed formula:
 *   base  = qty x unit price + licence + maintenance + cloud + AI
 *   net   = base less discount %
 *   total = net plus tax %
 */
export function lineMath(row: PricedRow, taxPercent: number) {
  const base =
    num(row.quantity) * num(row.unitPrice) +
    num(row.licenseCost) + num(row.maintenanceCost) + num(row.cloudCost) + num(row.aiCost);
  const afterDiscount = base * (1 - num(row.discountPercent) / 100);
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    base: round(base),
    net: round(afterDiscount),
    total: round(afterDiscount * (1 + taxPercent / 100)),
  };
}

/**
 * A saved line as an editable row. keepId says whether the row still edits
 * that line - true on the deal, false when a deal's lines are copied onto a
 * quote, where they become new lines of the quote.
 */
export function rowFromLine(line: SavedLine, keepId: boolean): PricedRow {
  return {
    key: nextRowKey(),
    id: keepId ? (line.id ?? null) : null,
    productId: line.productId ?? "",
    priceBookEntryId: line.priceBookEntryId,
    description: line.description ?? "",
    quantity: blankIfZero(line.quantity),
    unitPrice: blankIfZero(line.unitPrice),
    licenseCost: blankIfZero(line.licenseCost),
    maintenanceCost: blankIfZero(line.maintenanceCost),
    cloudCost: blankIfZero(line.cloudCost),
    aiCost: blankIfZero(line.aiCost),
    discountPercent: blankIfZero(line.discountPercent),
    taxRateId: line.taxRateId ?? "",
  };
}

export function emptyRow(): PricedRow {
  return {
    key: nextRowKey(), id: null, productId: "", priceBookEntryId: null, description: "",
    quantity: "", unitPrice: "", licenseCost: "", maintenanceCost: "",
    cloudCost: "", aiCost: "", discountPercent: "", taxRateId: "",
  };
}

/** Totals over the rows that name a product, and the hours that become tasks. */
export function rowTotals(rows: PricedRow[], catalogue: PricingCatalogue) {
  const taxById = new Map(catalogue.taxRates.map((t) => [t.id, Number(t.ratePercent)]));
  const productById = new Map(catalogue.products.map((p) => [p.id, p]));
  return rows
    .filter((r) => r.productId)
    .reduce(
      (acc, r) => {
        const m = lineMath(r, taxById.get(r.taxRateId) ?? 0);
        const p = productById.get(r.productId);
        return {
          base: acc.base + m.base,
          net: acc.net + m.net,
          total: acc.total + m.total,
          hours: p?.productType === "SERVICE" && p.addInTask ? acc.hours + num(r.quantity) : acc.hours,
        };
      },
      { base: 0, net: 0, total: 0, hours: 0 },
    );
}

/** The figures under a set of lines. */
export function PricedTotals({
  net,
  total,
  currency,
  label,
  hours,
  hoursNote = "will become project tasks when the deal is won.",
}: {
  net: number;
  total: number;
  currency: string;
  label: string;
  hours?: number;
  hoursNote?: string;
}) {
  return (
    <div className="flex flex-col items-end gap-1 border-t px-6 pt-3 text-sm">
      <p className="text-muted-foreground">
        Before tax <Money value={net} currency={currency} />
      </p>
      <p className="text-muted-foreground">
        Tax <Money value={total - net} currency={currency} />
      </p>
      <p className="text-base font-semibold">
        {label} <Money value={total} currency={currency} total />
      </p>
      {hours !== undefined && hours > 0 && (
        <p className="text-xs text-muted-foreground">{hours} hour(s) {hoursNote}</p>
      )}
    </div>
  );
}

/**
 * The book, then a product or service, and only then its pricing - filled from
 * the book and all editable. Every row is edited in place and saved together
 * by whoever holds the rows.
 */
export function PricedLinesEditor({
  rows,
  onRowsChange,
  bookId,
  onBookChange,
  bookLocked,
  bookLockedNote,
  bookHelp,
  catalogue,
  currency,
  disabled,
  withDescription,
  totalLabel,
  hoursNote,
}: {
  rows: PricedRow[];
  onRowsChange: (rows: PricedRow[]) => void;
  bookId: string;
  onBookChange: (bookId: string) => void;
  bookLocked: boolean;
  bookLockedNote?: string;
  bookHelp?: string;
  catalogue: PricingCatalogue;
  currency: string;
  disabled?: boolean;
  /** Show the customer-facing description on each line (quotes). */
  withDescription?: boolean;
  totalLabel: string;
  hoursNote?: string;
}) {
  const productById = useMemo(
    () => new Map(catalogue.products.map((p) => [p.id, p])),
    [catalogue.products],
  );
  const taxById = useMemo(
    () => new Map(catalogue.taxRates.map((t) => [t.id, Number(t.ratePercent)])),
    [catalogue.taxRates],
  );
  const pricesInBook = useMemo(
    () => new Map((catalogue.pricesByBook[bookId] ?? []).map((p) => [p.productId, p])),
    [catalogue.pricesByBook, bookId],
  );

  const productOptions = catalogue.products.map((p) => ({
    value: p.id,
    label: p.name,
    hint: p.productCode,
  }));
  const bookOptions = catalogue.books.map((b) => ({
    value: b.id,
    label: b.name,
    hint: b.validFrom || b.validTo ? `${b.validFrom ?? "…"} to ${b.validTo ?? "…"}` : undefined,
  }));

  function update(key: string, patch: Partial<PricedRow>) {
    onRowsChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /**
   * Choosing the item fills its pricing from the book. Anything the book does
   * not price is left BLANK rather than zero - an empty field says "nobody set
   * this"; a zero says "this is free".
   */
  function pickProduct(key: string, productId: string) {
    const price = pricesInBook.get(productId);
    update(key, {
      productId,
      priceBookEntryId: price?.entryId ?? null,
      quantity: price ? blankIfZero(price.quantity) || "1" : "1",
      unitPrice: price ? blankIfZero(price.rate) : "",
      licenseCost: price ? blankIfZero(price.licenseCost) : "",
      maintenanceCost: price ? blankIfZero(price.maintenanceCost) : "",
      cloudCost: price ? blankIfZero(price.cloudCost) : "",
      aiCost: price ? blankIfZero(price.aiCost) : "",
    });
  }

  const totals = rowTotals(rows, catalogue);

  return (
    <div className="space-y-5">
      <Field label="Price book" required help={bookHelp ?? "Only active books are offered."}>
        <div className="flex items-center gap-2">
          <BookMarked className="h-4 w-4 shrink-0 text-muted-foreground" />
          <SearchSelect
            options={bookOptions}
            value={bookId}
            onChange={(v) => onBookChange(v)}
            placeholder="Search price books…"
            disabled={bookLocked || disabled}
            ariaLabel="Price book"
            className="max-w-md flex-1"
          />
        </div>
        {bookLocked && bookLockedNote && (
          <p className="mt-1.5 text-xs text-muted-foreground">{bookLockedNote}</p>
        )}
      </Field>

      {bookId &&
        rows.map((row, i) => {
          const product = productById.get(row.productId);
          const hours = product?.productType === "SERVICE" && product.addInTask;
          const inBook = row.productId ? pricesInBook.has(row.productId) : false;
          const m = lineMath(row, taxById.get(row.taxRateId) ?? 0);

          const money = (key: keyof PricedRow, label: string) => (
            <Field label={label} key={key}>
              <Input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={row[key] as string}
                onChange={(e) => update(row.key, { [key]: e.target.value } as Partial<PricedRow>)}
                placeholder="—"
                aria-label={`Line ${i + 1} ${label}`}
                disabled={disabled}
              />
            </Field>
          );

          return (
            <div key={row.key} className="rounded-lg border p-4">
              <div className="flex items-start gap-3">
                <span className="mt-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <Field label="Product or service" required>
                    <SearchSelect
                      options={productOptions}
                      value={row.productId}
                      onChange={(v) => pickProduct(row.key, v)}
                      placeholder="Search by name or code…"
                      ariaLabel={`Line ${i + 1} product or service`}
                      disabled={disabled}
                    />
                  </Field>
                  {row.productId && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {inBook ? "Prices filled from the book." : "Not in this price book - enter its price."}
                      {hours && (
                        <span className="inline-flex items-center gap-1 font-medium text-primary">
                          <ListChecks className="h-3.5 w-3.5" /> Sold in hours — becomes a project task when won
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRowsChange(rows.filter((r) => r.key !== row.key))}
                  aria-label={`Remove line ${i + 1}`}
                  className="mt-6 text-muted-foreground hover:text-destructive"
                  disabled={disabled}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              {/* The pricing appears only once there is something to price. */}
              {row.productId && (
                <div className="mt-4 space-y-4 pl-9">
                  {withDescription && (
                    <Field label="Description on the quote" hint="Leave blank to use the product's name.">
                      <Input
                        value={row.description}
                        onChange={(e) => update(row.key, { description: e.target.value })}
                        placeholder={product?.name ?? ""}
                        maxLength={4000}
                        aria-label={`Line ${i + 1} description`}
                        disabled={disabled}
                      />
                    </Field>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {COSTS.map((c) => money(c.key, c.label))}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field
                      label={hours ? "Hours" : "Quantity"}
                      help={hours ? "The hours sold. They become the project task's budget." : undefined}
                    >
                      <Input
                        type="number"
                        min="0"
                        step="0.25"
                        inputMode="decimal"
                        value={row.quantity}
                        onChange={(e) => update(row.key, { quantity: e.target.value })}
                        aria-label={`Line ${i + 1} ${hours ? "hours" : "quantity"}`}
                        disabled={disabled}
                      />
                    </Field>
                    {money("unitPrice", hours ? "Rate per hour" : "Unit price")}
                    <Field label="Discount %">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={row.discountPercent}
                        onChange={(e) => update(row.key, { discountPercent: e.target.value })}
                        aria-label={`Line ${i + 1} discount percent`}
                        placeholder="0"
                        disabled={disabled}
                      />
                    </Field>
                    <Field label="Tax">
                      <Select
                        value={row.taxRateId}
                        onChange={(e) => update(row.key, { taxRateId: e.target.value })}
                        aria-label={`Line ${i + 1} tax`}
                        disabled={disabled}
                      >
                        <option value="">No tax</option>
                        {catalogue.taxRates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>

                  <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">
                      Before discount <Money value={m.base} currency={currency} />
                    </span>
                    <span className="text-muted-foreground">
                      After discount <Money value={m.net} currency={currency} />
                    </span>
                    <span className="font-semibold">
                      Line total <Money value={m.total} currency={currency} />
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

      {bookId && (
        <Button type="button" variant="outline" onClick={() => onRowsChange([...rows, emptyRow()])} disabled={disabled}>
          <Plus className="h-4 w-4" /> Add another product or service
        </Button>
      )}

      {bookId && rows.some((r) => r.productId) && (
        <PricedTotals
          net={totals.net}
          total={totals.total}
          currency={currency}
          label={totalLabel}
          hours={totals.hours}
          hoursNote={hoursNote}
        />
      )}
    </div>
  );
}
