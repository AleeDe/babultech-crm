"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, BookMarked, ListChecks, X } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select,
  Table, THead, TBody, TR, TH, TD,
} from "@/components/ui";
import { SearchSelect } from "@/components/search-select";
import { Money } from "@/components/money";
import { saveOpportunityLines, type OpportunityPricing } from "@/server/opportunity-lines";

/**
 * Opportunity Product Services: what this deal sells.
 *
 * Read-only until "Add Product & Service" is pressed; then every line becomes
 * editable at once, and all of them are saved together. One save for the whole
 * set is deliberate - the deal's amount is the sum of these lines, commission
 * pays on it, and a half-saved set would leave it summing something nobody
 * chose.
 *
 * The flow follows the agreed order: the price book first (only once - one book
 * per deal), then a product or service, and only then its pricing fields,
 * filled from the book and all editable.
 */

type Row = {
  key: string;
  id: string | null;
  productId: string;
  priceBookEntryId: string | null;
  quantity: string;
  unitPrice: string;
  licenseCost: string;
  maintenanceCost: string;
  cloudCost: string;
  aiCost: string;
  discountPercent: string;
  taxRateId: string;
};

const COSTS = [
  { key: "licenseCost", label: "License cost" },
  { key: "maintenanceCost", label: "Maintenance cost" },
  { key: "cloudCost", label: "Cloud cost" },
  { key: "aiCost", label: "AI cost" },
] as const;

let seq = 0;
const nextKey = () => `row-${++seq}`;

/** Blank rather than "0" when the value is zero, so an unpriced field reads as unpriced. */
const blankIfZero = (v: string | number | null | undefined) =>
  v === null || v === undefined || Number(v) === 0 ? "" : String(Number(v));

const n = (v: string) => Number(v || 0);

/**
 * The agreed formula, in the browser, for the live figures:
 *   base  = qty x unit price + licence + maintenance + cloud + AI
 *   net   = base less discount %
 *   total = net plus tax %
 * The database computes the same thing as generated columns, and it is those
 * that are saved; this is only what the person sees while typing.
 */
function lineMath(row: Row, taxPercent: number) {
  const base =
    n(row.quantity) * n(row.unitPrice) +
    n(row.licenseCost) + n(row.maintenanceCost) + n(row.cloudCost) + n(row.aiCost);
  const afterDiscount = base * (1 - n(row.discountPercent) / 100);
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    base: round(base),
    net: round(afterDiscount),
    total: round(afterDiscount * (1 + taxPercent / 100)),
  };
}

export function OpportunityProductServices({
  opportunityId,
  pricing,
  canWrite,
}: {
  opportunityId: string;
  pricing: OpportunityPricing;
  canWrite: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const currency = pricing.currencyCode;
  const lost = pricing.stage === "CLOSED_LOST";

  const fromLines = (): Row[] =>
    pricing.lines.map((l) => ({
      key: nextKey(),
      id: l.id,
      productId: l.productId,
      priceBookEntryId: l.priceBookEntryId,
      quantity: blankIfZero(l.quantity),
      unitPrice: blankIfZero(l.unitPrice),
      licenseCost: blankIfZero(l.licenseCost),
      maintenanceCost: blankIfZero(l.maintenanceCost),
      cloudCost: blankIfZero(l.cloudCost),
      aiCost: blankIfZero(l.aiCost),
      discountPercent: blankIfZero(l.discountPercent),
      taxRateId: l.taxRateId ?? "",
    }));

  const [bookId, setBookId] = useState(pricing.priceBookId ?? "");
  const [rows, setRows] = useState<Row[]>(fromLines);

  const productById = useMemo(
    () => new Map(pricing.products.map((p) => [p.id, p])),
    [pricing.products],
  );
  const taxById = useMemo(
    () => new Map(pricing.taxRates.map((t) => [t.id, Number(t.ratePercent)])),
    [pricing.taxRates],
  );
  const pricesInBook = useMemo(
    () => new Map((pricing.pricesByBook[bookId] ?? []).map((p) => [p.productId, p])),
    [pricing.pricesByBook, bookId],
  );

  // The book can change only while no saved line depends on it. Rows that were
  // only just added do not count: they have not been priced from anything yet.
  const bookLocked = rows.some((r) => r.id);

  const productOptions = pricing.products.map((p) => ({
    value: p.id,
    label: p.name,
    hint: p.productCode,
  }));

  const bookOptions = pricing.books.map((b) => ({
    value: b.id,
    label: b.name,
    hint: b.validFrom || b.validTo ? `${b.validFrom ?? "…"} to ${b.validTo ?? "…"}` : undefined,
  }));

  function update(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
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

  function addRow() {
    setRows((rs) => [
      ...rs,
      {
        key: nextKey(), id: null, productId: "", priceBookEntryId: null,
        quantity: "", unitPrice: "", licenseCost: "", maintenanceCost: "",
        cloudCost: "", aiCost: "", discountPercent: "", taxRateId: "",
      },
    ]);
  }

  function beginEditing() {
    setError(null);
    setRows(fromLines());
    setBookId(pricing.priceBookId ?? "");
    setEditing(true);
    if (pricing.lines.length === 0) addRow();
  }

  function cancel() {
    setError(null);
    setEditing(false);
    setRows(fromLines());
    setBookId(pricing.priceBookId ?? "");
  }

  function save() {
    setError(null);
    const usable = rows.filter((r) => r.productId);
    if (usable.length > 0 && !bookId) {
      setError("Choose the price book this deal is priced from first.");
      return;
    }
    start(async () => {
      const result = await saveOpportunityLines({
        opportunityId,
        priceBookId: bookId || null,
        lines: usable.map((r) => ({
          id: r.id,
          productId: r.productId,
          priceBookEntryId: r.priceBookEntryId,
          quantity: n(r.quantity),
          unitPrice: n(r.unitPrice),
          licenseCost: n(r.licenseCost),
          maintenanceCost: n(r.maintenanceCost),
          cloudCost: n(r.cloudCost),
          aiCost: n(r.aiCost),
          discountPercent: n(r.discountPercent),
          taxRateId: r.taxRateId || null,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // A full reload, deliberately, rather than router.refresh().
      //
      // In the production build the in-place refresh never landed on this page:
      // the save had worked - the lines, the amount and the book were all in the
      // database - but the screen kept the old page and still said "Nothing
      // added yet", which would lead anybody to save again. It worked in
      // development, and a reload always showed the right data. Until the router
      // behaviour on this page is understood, a reload is the one thing that is
      // guaranteed to show the deal as it now stands, including the value tiles
      // above that also depend on these lines.
      window.location.reload();
    });
  }

  // Totals, from whichever set is on screen.
  const shown = editing ? rows.filter((r) => r.productId) : fromLines();
  const totals = shown.reduce(
    (acc, r) => {
      const m = lineMath(r, taxById.get(r.taxRateId) ?? 0);
      return { net: acc.net + m.net, total: acc.total + m.total };
    },
    { net: 0, total: 0 },
  );
  const taskHours = shown.reduce((sum, r) => {
    const p = productById.get(r.productId);
    return p?.productType === "SERVICE" && p.addInTask ? sum + n(r.quantity) : sum;
  }, 0);

  const bookName = pricing.books.find((b) => b.id === (editing ? bookId : pricing.priceBookId))?.name;

  // ---------------------------------------------------------------------------
  // Read-only
  // ---------------------------------------------------------------------------

  if (!editing) {
    return (
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Opportunity Product Services</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {bookName ? (
                <>
                  Priced from <span className="font-medium text-foreground">{bookName}</span>.
                  {taskHours > 0 && ` ${taskHours} sold hour(s) become project tasks when the deal is won.`}
                </>
              ) : (
                "Nothing added yet. The deal's value becomes the total of what is added here."
              )}
            </p>
          </div>
          {canWrite && !lost && (
            <Button onClick={beginEditing}>
              <Plus className="h-4 w-4" />
              {pricing.lines.length ? "Edit products & services" : "Add Product & Service"}
            </Button>
          )}
        </CardHeader>

        {pricing.lines.length > 0 && (
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>Product / Service</TH>
                  <TH className="text-right">Qty / Hours</TH>
                  <TH className="text-right" priority="secondary">Unit price</TH>
                  <TH className="text-right" priority="tertiary">Costs</TH>
                  <TH className="text-right" priority="secondary">Disc.</TH>
                  <TH className="text-right" priority="tertiary">Tax</TH>
                  <TH className="text-right">Total</TH>
                </TR>
              </THead>
              <TBody>
                {pricing.lines.map((l) => {
                  const hours = l.product?.productType === "SERVICE" && l.product.addInTask;
                  const costs =
                    Number(l.licenseCost) + Number(l.maintenanceCost) + Number(l.cloudCost) + Number(l.aiCost);
                  return (
                    <TR key={l.id}>
                      <TD>
                        <p className="text-sm font-medium">{l.product?.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {l.product?.productCode}
                          {hours && <Badge tone="info" className="ml-2">Becomes a task</Badge>}
                        </p>
                      </TD>
                      <TD className="text-right tabular-nums">
                        {Number(l.quantity)}
                        {hours && <span className="ml-1 text-xs text-muted-foreground">h</span>}
                      </TD>
                      <TD className="text-right" priority="secondary"><Money value={l.unitPrice} currency={currency} stacked /></TD>
                      <TD className="text-right" priority="tertiary">
                        {costs > 0 ? <Money value={costs} currency={currency} stacked /> : "—"}
                      </TD>
                      <TD className="text-right tabular-nums" priority="secondary">
                        {Number(l.discountPercent) > 0 ? `${Number(l.discountPercent)}%` : "—"}
                      </TD>
                      <TD className="text-right tabular-nums" priority="tertiary">
                        {Number(l.taxPercent) > 0 ? `${Number(l.taxPercent)}%` : "—"}
                      </TD>
                      <TD className="text-right font-medium"><Money value={l.lineTotal} currency={currency} stacked /></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Totals net={totals.net} total={totals.total} currency={currency} />
          </CardContent>
        )}
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  return (
    <Card className="border-primary/40">
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Opportunity Product Services</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Figures come from the price book and every one can be changed. Nothing is saved until you press Save.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}

        <Field
          label="Price book"
          required
          help="One price book per deal. Only active books are offered."
        >
          <div className="flex items-center gap-2">
            <BookMarked className="h-4 w-4 shrink-0 text-muted-foreground" />
            <SearchSelect
              options={bookOptions}
              value={bookId}
              onChange={(v) => setBookId(v)}
              placeholder="Search price books…"
              disabled={bookLocked}
              ariaLabel="Price book"
              className="max-w-md flex-1"
            />
          </div>
          {bookLocked && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Locked while this deal has products priced from it. Remove them all to choose a different book.
            </p>
          )}
        </Field>

        {bookId &&
          rows.map((row, i) => {
            const product = productById.get(row.productId);
            const hours = product?.productType === "SERVICE" && product.addInTask;
            const inBook = row.productId ? pricesInBook.has(row.productId) : false;
            const m = lineMath(row, taxById.get(row.taxRateId) ?? 0);

            const money = (key: keyof Row, label: string) => (
              <Field label={label} key={key}>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={row[key] as string}
                  onChange={(e) => update(row.key, { [key]: e.target.value } as Partial<Row>)}
                  placeholder="—"
                  aria-label={`Line ${i + 1} ${label}`}
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
                    variant="ghost"
                    size="sm"
                    onClick={() => setRows((rs) => rs.filter((r) => r.key !== row.key))}
                    aria-label={`Remove line ${i + 1}`}
                    className="mt-6 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* The pricing appears only once there is something to price. */}
                {row.productId && (
                  <div className="mt-4 space-y-4 pl-9">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      {COSTS.map((c) => money(c.key, c.label))}
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <Field label={hours ? "Hours" : "Quantity"} help={hours ? "The hours sold. They become the project task's budget." : undefined}>
                        <Input
                          type="number"
                          min="0"
                          step="0.25"
                          inputMode="decimal"
                          value={row.quantity}
                          onChange={(e) => update(row.key, { quantity: e.target.value })}
                          aria-label={`Line ${i + 1} ${hours ? "hours" : "quantity"}`}
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
                        />
                      </Field>
                      <Field label="Tax">
                        <Select value={row.taxRateId} onChange={(e) => update(row.key, { taxRateId: e.target.value })} aria-label={`Line ${i + 1} tax`}>
                          <option value="">No tax</option>
                          {pricing.taxRates.map((t) => (
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
          <Button variant="outline" onClick={addRow} disabled={pending}>
            <Plus className="h-4 w-4" /> Add another product or service
          </Button>
        )}

        {bookId && shown.length > 0 && (
          <Totals net={totals.net} total={totals.total} currency={currency} hours={taskHours} />
        )}

        <div className="flex gap-2 border-t pt-4">
          <Button onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save products & services"}
          </Button>
          <Button variant="ghost" onClick={cancel} disabled={pending}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Totals({
  net,
  total,
  currency,
  hours,
}: {
  net: number;
  total: number;
  currency: string;
  hours?: number;
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
        Deal total <Money value={total} currency={currency} />
      </p>
      {hours !== undefined && hours > 0 && (
        <p className="text-xs text-muted-foreground">{hours} hour(s) will become project tasks when the deal is won.</p>
      )}
    </div>
  );
}
