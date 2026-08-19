"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Upload, ArrowLeft } from "lucide-react";
import {
  Card, Button, Alert, Field, Select, Textarea,
  Table, THead, TBody, TR, TH, TD, Badge,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils";
import { parseExpenseRows, matchCategoryId } from "@/lib/parse-expense-rows";
import { createExpensesBulk } from "@/server/payables";

type Option = { id: string; name: string };

const SAMPLE = `Expense Type\tExpense By\tExpense Date\tExpense Amount\tNotes
Rent\tHasan\t5/8/2026\t45000\t2 months advance
Internet\tHasan\t2/12/2026\t7000\tInternet plus router`;

/**
 * Paste-to-import.
 *
 * Two steps on purpose. The paste is parsed and shown back with the category it
 * matched, the date it read and anything it could not read; only then is the
 * import button enabled. Dates are the reason — "06/11/2026" is a real date
 * under both readings, and the only way to catch a wrong one is to show it.
 *
 * Nothing is written until every row is clean, so a rejected paste can be fixed
 * and re-pasted without worrying about which half already landed.
 */
export function ExpenseImportForm({
  categories,
  users,
  projects,
  currencies,
}: {
  categories: Option[];
  users: { id: string; fullName: string }[];
  projects: Option[];
  currencies: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [employeeUserId, setEmployeeUserId] = useState(users[0]?.id ?? "");
  const [projectId, setProjectId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("PKR");
  const [fallbackCategoryId, setFallbackCategoryId] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => (text.trim() ? parseExpenseRows(text) : []), [text]);

  const resolved = useMemo(
    () =>
      rows.map((row) => {
        // Same matcher the importer script uses, so a paste and a scripted
        // import file the same row under the same category.
        const matched = matchCategoryId(row.type, categories);
        const categoryId = matched ?? fallbackCategoryId;
        const errors = [...row.errors];
        if (!categoryId) {
          errors.push(`No category matches "${row.type}" — pick a fallback below.`);
        }
        return { ...row, categoryId, matched: Boolean(matched), errors };
      }),
    [rows, fallbackCategoryId, categories],
  );

  const badRows = resolved.filter((r) => r.errors.length > 0);
  const flagged = resolved.filter((r) => r.errors.length === 0 && r.dateNote);
  const total = resolved.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const canImport = resolved.length > 0 && badRows.length === 0 && Boolean(employeeUserId);

  function submit() {
    setError(null);
    start(async () => {
      const result = await createExpensesBulk(
        resolved.map((r) => ({
          categoryId: r.categoryId,
          expenseDate: r.date!,
          amount: r.amount!,
          currencyCode,
          description: r.notes || r.type,
          employeeUserId,
          projectId: projectId || null,
          billableToCustomer: false,
          reimbursable: true,
        })),
      );

      if (!result.ok) {
        setError(result.error ?? "The import did not run.");
        return;
      }
      router.push("/expenses");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger"><span className="whitespace-pre-line">{error}</span></Alert>}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Paid by" required>
            <Select value={employeeUserId} onChange={(e) => setEmployeeUserId(e.target.value)}>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.fullName}</option>
              ))}
            </Select>
          </Field>
          <Field label="Currency">
            <Select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project (optional)">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None — general overhead</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-4">
          <Field
            label="Rows"
            hint="Expense Type, Expense By, Expense Date, Expense Amount, Notes — tab or comma separated. A header row is ignored."
            required
          >
            <Textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={SAMPLE}
              className="font-mono text-xs"
            />
          </Field>
        </div>

        {rows.length > 0 && !resolved.every((r) => r.matched) && (
          <div className="mt-4">
            <Field
              label="Fallback category"
              hint="Used for any row whose type does not match a category by name."
            >
              <Select
                value={fallbackCategoryId}
                onChange={(e) => setFallbackCategoryId(e.target.value)}
              >
                <option value="">Choose…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Card>

      {resolved.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center gap-3 border-b p-4">
            <span className="text-sm font-medium">
              {resolved.length} row{resolved.length === 1 ? "" : "s"}
              <span className="ml-2 font-normal text-muted-foreground tabular">
                {formatMoney(total, currencyCode)}
              </span>
            </span>
            {badRows.length > 0 && (
              <Badge tone="danger">{badRows.length} need fixing</Badge>
            )}
            {flagged.length > 0 && (
              <Badge tone="warning">
                <AlertTriangle className="h-3 w-3" /> {flagged.length} date{flagged.length === 1 ? "" : "s"} to check
              </Badge>
            )}
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={() => setText("")} disabled={pending}>
                <ArrowLeft className="h-4 w-4" /> Clear
              </Button>
              <Button onClick={submit} disabled={!canImport || pending}>
                <Upload className="h-4 w-4" />
                {pending ? "Importing…" : `Import ${resolved.length}`}
              </Button>
            </div>
          </div>

          <Table>
            <THead>
              <TR>
                <TH className="w-10">#</TH>
                <TH>Type → Category</TH>
                <TH>Date</TH>
                <TH className="text-right">Amount</TH>
                <TH>Notes</TH>
              </TR>
            </THead>
            <TBody>
              {resolved.map((row) => (
                <TR key={row.line} className={row.errors.length ? "bg-destructive/5" : undefined}>
                  <TD className="text-xs text-muted-foreground">{row.line}</TD>
                  <TD className="text-sm">
                    {row.type || <span className="text-muted-foreground">—</span>}
                    {!row.matched && row.categoryId && (
                      <p className="text-xs text-muted-foreground">
                        → {categories.find((c) => c.id === row.categoryId)?.name}
                      </p>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap text-sm">
                    {row.date ?? <span className="text-destructive">—</span>}
                    {row.dateNote && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">{row.dateNote}</p>
                    )}
                  </TD>
                  <TD className="text-right tabular">
                    {row.amount !== null ? formatMoney(row.amount, currencyCode) : "—"}
                  </TD>
                  <TD className="max-w-[240px] text-sm">
                    <span className="block truncate text-muted-foreground">{row.notes || "—"}</span>
                    {row.errors.map((e) => (
                      <p key={e} className="text-xs text-destructive">{e}</p>
                    ))}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
