"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2, Check } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Table, THead, TBody, TR, TH, TD, EmptyState, Select,
} from "@/components/ui";
import {
  savePriceBook, savePriceBookEntry, deletePriceBookEntry, copyPriceBook,
  type PriceBook, type PriceBookEntry,
} from "@/server/price-books";
import { formatMoney } from "@/lib/utils";

interface CatalogueItem {
  id: string;
  name: string;
  productCode: string;
  productType: "PRODUCT" | "SERVICE";
  addInTask: boolean;
}

const COSTS = [
  { key: "licenseCost", label: "License" },
  { key: "maintenanceCost", label: "Maintenance" },
  { key: "cloudCost", label: "Cloud" },
  { key: "aiCost", label: "AI" },
] as const;

type Draft = {
  quantity: string;
  rate: string;
  licenseCost: string;
  maintenanceCost: string;
  cloudCost: string;
  aiCost: string;
};

const total = (d: Draft) =>
  Number(d.quantity || 0) * Number(d.rate || 0) +
  Number(d.licenseCost || 0) + Number(d.maintenanceCost || 0) +
  Number(d.cloudCost || 0) + Number(d.aiCost || 0);

/**
 * A price book's prices, edited in a table.
 *
 * Quantity is labelled HOURS on a service sold by the hour. Those are the hours
 * a deal starts with, and the hours that become a project task - so the column
 * should say what the number is, not just that it is a number.
 */
export function PriceBookEditor({
  book,
  catalogue,
  canWrite,
}: {
  book: PriceBook & { entries: PriceBookEntry[] };
  catalogue: CatalogueItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, Draft>>(
    Object.fromEntries(
      book.entries.map((e) => [
        e.id,
        {
          quantity: String(Number(e.quantity)),
          rate: String(Number(e.rate)),
          licenseCost: String(Number(e.licenseCost)),
          maintenanceCost: String(Number(e.maintenanceCost)),
          cloudCost: String(Number(e.cloudCost)),
          aiCost: String(Number(e.aiCost)),
        },
      ]),
    ),
  );

  // Items not in the book yet, so the add dropdown offers only what can be added.
  const priced = useMemo(() => new Set(book.entries.map((e) => e.productId)), [book.entries]);
  const addable = catalogue.filter((c) => !priced.has(c.id));
  const [addId, setAddId] = useState("");

  const set = (id: string, key: keyof Draft, value: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));

  function saveEntry(e: PriceBookEntry) {
    const d = drafts[e.id];
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await savePriceBookEntry({
        id: e.id,
        priceBookId: book.id,
        productId: e.productId,
        quantity: Number(d.quantity || 0),
        rate: Number(d.rate || 0),
        licenseCost: Number(d.licenseCost || 0),
        maintenanceCost: Number(d.maintenanceCost || 0),
        cloudCost: Number(d.cloudCost || 0),
        aiCost: Number(d.aiCost || 0),
        active: true,
      });
      if (result.ok) {
        setNotice(`${e.product?.name ?? "Price"} saved.`);
        router.refresh();
      } else setError(result.error);
    });
  }

  function addEntry() {
    if (!addId) return;
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await savePriceBookEntry({
        priceBookId: book.id,
        productId: addId,
        quantity: 1,
        rate: 0,
        licenseCost: 0,
        maintenanceCost: 0,
        cloudCost: 0,
        aiCost: 0,
        active: true,
      });
      if (result.ok) {
        setAddId("");
        router.refresh();
      } else setError(result.error);
    });
  }

  function removeEntry(e: PriceBookEntry) {
    if (!window.confirm(`Remove ${e.product?.name ?? "this"} from ${book.name}? Deals already priced from it keep their prices.`)) return;
    start(async () => {
      const result = await deletePriceBookEntry(e.id, book.id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function toggleActive() {
    start(async () => {
      const result = await savePriceBook({
        id: book.id,
        name: book.name,
        description: book.description,
        currencyCode: book.currencyCode,
        validFrom: book.validFrom,
        validTo: book.validTo,
        active: !book.active,
      });
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function copy() {
    const name = window.prompt("Name for the copy - usually next year's:", `${new Date().getFullYear() + 1} Standard Rates`);
    if (!name) return;
    start(async () => {
      const result = await copyPriceBook(book.id, name);
      if (result.ok) {
        router.push(`/price-books/${result.data.id}`);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={copy} disabled={pending}>
            <Copy className="h-4 w-4" /> Copy to a new book
          </Button>
          <Button variant="outline" onClick={toggleActive} disabled={pending}>
            {book.active ? "Make inactive" : "Make active"}
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Prices</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            A deal priced from this book starts with these figures, and every one of them can be changed on the deal.
          </p>
        </CardHeader>

        {book.entries.length === 0 ? (
          <CardContent>
            <EmptyState
              title="Nothing priced yet"
              description="Add the products and services this book prices."
            />
          </CardContent>
        ) : (
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>Item</TH>
                  <TH className="text-right">Qty / Hours</TH>
                  <TH className="text-right">Rate</TH>
                  {COSTS.map((c) => (
                    <TH key={c.key} className="text-right" priority="secondary">{c.label}</TH>
                  ))}
                  <TH className="text-right">Total</TH>
                  {canWrite && <TH />}
                </TR>
              </THead>
              <TBody>
                {book.entries.map((e) => {
                  const d = drafts[e.id];
                  const hours = e.product?.productType === "SERVICE" && e.product.addInTask;
                  const cell = (key: keyof Draft, width = "w-24") =>
                    canWrite ? (
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={d[key]}
                        onChange={(ev) => set(e.id, key, ev.target.value)}
                        className={`${width} text-right`}
                        aria-label={`${e.product?.name} ${key}`}
                      />
                    ) : (
                      <span className="tabular-nums">{Number(d[key]).toLocaleString("en-PK")}</span>
                    );
                  return (
                    <TR key={e.id}>
                      <TD>
                        <p className="text-sm font-medium">{e.product?.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {e.product?.productCode}
                          {hours && <Badge tone="info" className="ml-2">Hours</Badge>}
                        </p>
                      </TD>
                      <TD className="text-right">{cell("quantity", "w-20")}</TD>
                      <TD className="text-right">{cell("rate")}</TD>
                      {COSTS.map((c) => (
                        <TD key={c.key} className="text-right" priority="secondary">{cell(c.key)}</TD>
                      ))}
                      <TD className="whitespace-nowrap text-right text-sm font-medium">
                        {formatMoney(total(d), book.currencyCode)}
                      </TD>
                      {canWrite && (
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => saveEntry(e)} disabled={pending} aria-label={`Save ${e.product?.name}`}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => removeEntry(e)} disabled={pending} aria-label={`Remove ${e.product?.name}`} className="text-muted-foreground hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardContent>
        )}

        {canWrite && addable.length > 0 && (
          <CardContent className="border-t pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Add to this book">
                <Select value={addId} onChange={(e) => setAddId(e.target.value)} className="w-80">
                  <option value="">Choose a product or service…</option>
                  {addable.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.productCode} — {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button onClick={addEntry} disabled={pending || !addId}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
