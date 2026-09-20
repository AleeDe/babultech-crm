"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2, Check, X, Pencil } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
  Table, THead, TBody, TR, TH, TD, Button, Input, Select, Badge, Alert,
} from "@/components/ui";
import {
  saveCurrency, deleteCurrency, saveTaxRate, saveNamedRow, deleteNamedRow,
  type Currency, type TaxRate, type NamedRow,
} from "@/server/settings";

type Result = { ok: true } | { ok: false; error: string };

/** Shared feedback strip: one message at a time, cleared on the next action. */
function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<Result>, after?: () => void) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.ok) after?.();
      else setError(result.error);
    });
  }

  return { pending, error, run };
}

// ------------------------------------------------------------------ currency

export function CurrencyList({ rows }: { rows: Currency[] }) {
  const [adding, setAdding] = useState(false);
  const { pending, error, run } = useAction();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Currencies</CardTitle>
          <CardDescription>
            Every amount is quoted in one of these. Rates are expressed against the base currency.
          </CardDescription>
        </div>
        <Button variant="secondary" onClick={() => setAdding((v) => !v)}>
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {adding ? "Cancel" : "Add"}
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {error && <div className="px-4 pb-3"><Alert tone="danger">{error}</Alert></div>}

        {adding && (
          <form
            className="flex flex-wrap items-end gap-2 border-b bg-muted/30 p-4"
            action={(fd) => run(() => saveCurrency(fd), () => setAdding(false))}
          >
            <Input name="code" placeholder="PKR" maxLength={3} required className="w-20 uppercase" />
            <Input name="name" placeholder="Pakistani Rupee" required className="min-w-[180px] flex-1" />
            <Input name="symbol" placeholder="Rs" className="w-24" />
            <Input name="exchangeRate" type="number" step="0.0001" placeholder="1.0" required className="w-32" />
            <Button type="submit" disabled={pending}>Save</Button>
          </form>
        )}

        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No currencies yet. Add the one you invoice in first - make it the base.
          </p>
        ) : (
          <Table>
            <THead>
              <TR><TH>Code</TH><TH>Name</TH><TH>Symbol</TH><TH className="text-right">Rate</TH><TH /></TR>
            </THead>
            <TBody>
              {rows.map((c) => (
                <TR key={c.code}>
                  <TD className="font-medium">
                    {c.code} {c.isBase && <Badge tone="info">Base</Badge>}
                  </TD>
                  <TD>{c.name}</TD>
                  <TD className="text-muted-foreground">{c.symbol ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{c.exchangeRate}</TD>
                  <TD className="text-right">
                    {!c.isBase && (
                      <button
                        onClick={() => run(() => deleteCurrency(c.code))}
                        disabled={pending}
                        aria-label={`Remove ${c.code}`}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ tax rate

export function TaxRateList({ rows }: { rows: TaxRate[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { pending, error, run } = useAction();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Tax rates</CardTitle>
          <CardDescription>Applied to quote and invoice lines.</CardDescription>
        </div>
        <Button variant="secondary" onClick={() => setAdding((v) => !v)}>
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {adding ? "Cancel" : "Add"}
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {error && <div className="px-4 pb-3"><Alert tone="danger">{error}</Alert></div>}

        {adding && (
          <form
            className="flex flex-wrap items-end gap-2 border-b bg-muted/30 p-4"
            action={(fd) => run(() => saveTaxRate(fd), () => setAdding(false))}
          >
            <Input name="name" placeholder="GST 18%" required className="min-w-[160px] flex-1" />
            <Input name="ratePercent" type="number" step="0.01" placeholder="18" required className="w-28" />
            <Select name="taxType" defaultValue="SALES" className="w-40">
              <option value="SALES">Sales</option>
              <option value="WITHHOLDING">Withholding</option>
              <option value="PURCHASE">Purchase</option>
            </Select>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="active" defaultChecked /> Active
            </label>
            <Button type="submit" disabled={pending}>Save</Button>
          </form>
        )}

        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">No tax rates yet.</p>
        ) : (
          <Table>
            <THead>
              <TR><TH>Name</TH><TH className="text-right">Rate</TH><TH>Type</TH><TH>Status</TH><TH /></TR>
            </THead>
            <TBody>
              {rows.map((t) =>
                editing === t.id ? (
                  <TR key={t.id}>
                    <TD colSpan={5} className="bg-muted/30">
                      <form
                        className="flex flex-wrap items-end gap-2"
                        action={(fd) => run(() => saveTaxRate(fd), () => setEditing(null))}
                      >
                        <input type="hidden" name="id" value={t.id} />
                        <Input name="name" defaultValue={t.name} required className="min-w-[160px] flex-1" />
                        <Input name="ratePercent" type="number" step="0.01" defaultValue={t.ratePercent} required className="w-28" />
                        <Select name="taxType" defaultValue={t.taxType} className="w-40">
                          <option value="SALES">Sales</option>
                          <option value="WITHHOLDING">Withholding</option>
                          <option value="PURCHASE">Purchase</option>
                        </Select>
                        <label className="flex items-center gap-1.5 text-sm">
                          <input type="checkbox" name="active" defaultChecked={t.active} /> Active
                        </label>
                        <Button type="submit" disabled={pending}><Check className="h-4 w-4" /></Button>
                        <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </form>
                    </TD>
                  </TR>
                ) : (
                  <TR key={t.id} className={t.active ? undefined : "opacity-60"}>
                    <TD className="font-medium">{t.name}</TD>
                    <TD className="text-right tabular-nums">{t.ratePercent}%</TD>
                    <TD className="text-muted-foreground">{t.taxType.toLowerCase()}</TD>
                    <TD><Badge tone={t.active ? "success" : "neutral"}>{t.active ? "Active" : "Inactive"}</Badge></TD>
                    <TD className="text-right">
                      <button
                        onClick={() => setEditing(t.id)}
                        aria-label={`Edit ${t.name}`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    </TD>
                  </TR>
                ),
              )}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------- name-only

export function NamedList({
  kind,
  title,
  description,
  rows,
}: {
  kind: "department" | "caseCategory" | "expenseCategory" | "campaignType";
  title: string;
  description: string;
  rows: NamedRow[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const { pending, error, run } = useAction();

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button variant="secondary" onClick={() => setAdding((v) => !v)}>
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {adding ? "Cancel" : "Add"}
        </Button>
      </CardHeader>

      <CardContent className="p-0">
        {error && <div className="px-4 pb-3"><Alert tone="danger">{error}</Alert></div>}

        {adding && (
          <form
            className="flex items-end gap-2 border-b bg-muted/30 p-4"
            action={(fd) => run(() => saveNamedRow(kind, fd), () => setAdding(false))}
          >
            <Input name="name" placeholder="Name" required className="flex-1" />
            <Button type="submit" disabled={pending}>Save</Button>
          </form>
        )}

        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Nothing here yet.</p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2 px-4 py-2.5">
                {editing === r.id ? (
                  <form
                    className="flex flex-1 items-center gap-2"
                    action={(fd) => run(() => saveNamedRow(kind, fd), () => setEditing(null))}
                  >
                    <input type="hidden" name="id" value={r.id} />
                    <Input name="name" defaultValue={r.name} required className="flex-1" />
                    <Button type="submit" disabled={pending}><Check className="h-4 w-4" /></Button>
                    <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="flex-1 text-sm">{r.name}</span>
                    <button
                      onClick={() => setEditing(r.id)}
                      aria-label={`Edit ${r.name}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => run(() => deleteNamedRow(kind, r.id))}
                      disabled={pending}
                      aria-label={`Remove ${r.name}`}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
