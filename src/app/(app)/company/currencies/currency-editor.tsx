"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input,
  Table, THead, TBody, TR, TH, TD,
} from "@/components/ui";
import { saveCurrency, type CurrencyRow } from "@/server/company";

/**
 * Rates, edited in place.
 *
 * Each rate is how many PKR one unit buys, and the page says so beside every
 * one - "1 USD = PKR 278" - because a rate typed the wrong way round (0.0036
 * instead of 278) is the classic mistake, and it would make every converted
 * figure in the system wrong by a factor of seventy thousand.
 */
export function CurrencyEditor({
  currencies,
  defaultCurrency,
  corporateCurrency,
}: {
  currencies: CurrencyRow[];
  defaultCurrency: string;
  corporateCurrency: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [rates, setRates] = useState<Record<string, string>>(
    Object.fromEntries(currencies.map((c) => [c.code, String(Number(c.exchangeRate))])),
  );

  const base = currencies.find((c) => c.isBase)?.code ?? "PKR";

  function save(c: CurrencyRow, active = c.active) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await saveCurrency({
        code: c.code,
        name: c.name,
        symbol: c.symbol,
        exchangeRate: Number(rates[c.code]),
        active,
      });
      if (result.ok) {
        setNotice(`${c.code} saved. Converted amounts use it from the next page you open.`);
        router.refresh();
      } else setError(result.error);
    });
  }

  function add(fd: FormData) {
    setError(null);
    setNotice(null);
    start(async () => {
      const result = await saveCurrency({
        code: String(fd.get("code") ?? ""),
        name: String(fd.get("name") ?? ""),
        symbol: String(fd.get("symbol") ?? ""),
        exchangeRate: Number(fd.get("exchangeRate")),
        active: true,
      });
      if (result.ok) {
        setAdding(false);
        setNotice("Currency added.");
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <Alert tone="info">
        <span className="font-medium">A rate is how many {base} one unit buys.</span> USD 278 means
        1 USD = {base} 278. Check them against today&apos;s market before relying on them — the
        starting rates for CAD, AUD and AED are approximate.
      </Alert>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Currencies and rates</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setAdding(!adding)}>
            <Plus className="h-4 w-4" /> {adding ? "Cancel" : "Add a currency"}
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          {adding && (
            <form action={add} className="mx-6 mb-5 grid gap-3 rounded-md border bg-muted/30 p-4 sm:grid-cols-4">
              <Field label="Code" required>
                <Input name="code" required maxLength={3} placeholder="GBP" className="uppercase" />
              </Field>
              <Field label="Name" required>
                <Input name="name" required maxLength={100} placeholder="British Pound" />
              </Field>
              <Field label="Symbol">
                <Input name="symbol" maxLength={10} placeholder="£" />
              </Field>
              <Field label={`1 unit = ${base}`} required>
                <Input name="exchangeRate" type="number" step="0.000001" min="0.000001" required placeholder="355" />
              </Field>
              <div className="sm:col-span-4">
                <Button type="submit" size="sm" disabled={pending}>Add</Button>
              </div>
            </form>
          )}

          <Table>
            <THead>
              <TR>
                <TH>Currency</TH>
                <TH>Rate</TH>
                <TH>Role</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {currencies.map((c) => (
                <TR key={c.code}>
                  <TD>
                    <span className="font-mono text-sm font-medium">{c.code}</span>
                    <p className="text-xs text-muted-foreground">{c.name}</p>
                  </TD>
                  <TD>
                    {c.isBase ? (
                      <span className="text-sm text-muted-foreground">1 — every rate is measured against it</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="whitespace-nowrap text-sm text-muted-foreground">1 {c.code} = {base}</span>
                        <Input
                          type="number"
                          step="0.000001"
                          min="0.000001"
                          value={rates[c.code] ?? ""}
                          onChange={(e) => setRates((r) => ({ ...r, [c.code]: e.target.value }))}
                          className="w-32"
                          aria-label={`${c.code} rate`}
                        />
                      </div>
                    )}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {c.isBase && <Badge tone="info">Base</Badge>}
                      {c.code === defaultCurrency && <Badge tone="success">Default</Badge>}
                      {c.code === corporateCurrency && <Badge tone="neutral">Corporate</Badge>}
                      {!c.active && <Badge tone="warning">Off</Badge>}
                    </div>
                  </TD>
                  <TD className="text-right">
                    {!c.isBase && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => save(c)} disabled={pending}>Save rate</Button>
                        <Button size="sm" variant="ghost" onClick={() => save(c, !c.active)} disabled={pending}>
                          {c.active ? "Switch off" : "Switch on"}
                        </Button>
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
