"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Upload, ArrowLeft, FileSpreadsheet, Plus } from "lucide-react";
import {
  Card, Button, Alert, Field, Select, Textarea,
  Table, THead, TBody, TR, TH, TD, Badge,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils";
import {
  splitSheet, sheetFromWorkbookRows, guessMapping, parseMappedRows, matchCategoryId, matchUserId,
  IMPORT_FIELDS, type ColumnMapping, type ImportField, type SplitSheet,
} from "@/lib/parse-expense-rows";
import { createExpensesBulk, createExpenseCategory } from "@/server/payables";

type Option = { id: string; name: string };

const SAMPLE = `Expense Type\tExpense By\tExpense Date\tExpense Amount\tNotes
Rent\tHasan\t5/8/2026\t45000\t2 months advance
Internet\tHasan\t2/12/2026\t7000\tInternet plus router`;

/**
 * File-to-import, with pasting kept as the fallback.
 *
 * A file is what people actually have: a CSV out of Excel or Google Sheets.
 * The paste box was the only way in for a while, which meant the screen asked
 * for a file's contents rather than the file, so it is still here but no longer
 * the thing the eye lands on. Both feed the same string, so the two routes
 * cannot disagree about what gets imported.
 *
 * Three steps on purpose. The rows are split into a table, the columns are
 * shown with a guess at what each one holds, and only then is anything read as
 * a date or an amount. The middle step is what makes a sheet in any order
 * importable: the guess covers the common cases, and where it is wrong the
 * dropdown above the column corrects it without anyone rearranging their
 * spreadsheet first.
 *
 * The preview stays the last word. Dates are the reason — "06/11/2026" is a
 * real date under both readings, and the only way to catch a wrong one is to
 * show it. Nothing is written until every row is clean, so a rejected sheet can
 * be fixed and dropped again without worrying about which half already landed.
 */
export function ExpenseImportForm({
  categories,
  vendors,
  users,
  projects,
  currencies,
}: {
  categories: Option[];
  vendors: Option[];
  users: { id: string; fullName: string }[];
  projects: Option[];
  currencies: { code: string; name: string }[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  // Set only when an .xlsx is loaded; a CSV or a paste leaves these empty and
  // goes through `text` instead. One of the two is always the source.
  const [workbookSheets, setWorkbookSheets] = useState<SplitSheet[]>([]);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [employeeUserId, setEmployeeUserId] = useState(users[0]?.id ?? "");
  // Whose money went out. The old form asked this three separate ways - an
  // employee dropdown, a supplier dropdown, and a Reimbursable tick - and the
  // import asked it not at all, quietly marking every row reimbursable. It is
  // one question, so it is one control.
  const [paidByCompany, setPaidByCompany] = useState(false);
  const [vendorAccountId, setVendorAccountId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("PKR");
  const [fallbackCategoryId, setFallbackCategoryId] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Categories created from this screen, held alongside the ones passed in so
  // the matcher can see them without waiting on a round trip.
  //
  // Deduplicated by id, because the refresh that follows a create brings the
  // same rows back down in `categories` and the fallback dropdown would
  // otherwise list every new category twice.
  const [added, setAdded] = useState<Option[]>([]);
  const known = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    for (const c of added) byId.set(c.id, c);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, added]);

  const workbook = workbookSheets[sheetIndex] ?? null;
  const sheet = useMemo(() => workbook ?? splitSheet(text), [workbook, text]);

  // The guess is a starting point, not the mapping: once someone corrects a
  // column their choice has to survive re-renders, so it is held in state and
  // only re-guessed when the shape of the paste changes underneath it.
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const signature = `${sheet.width}|${sheet.header?.join(" ") ?? ""}|${sheet.rows.length > 0}`;

  useEffect(() => {
    setMapping(guessMapping(sheet));
    // Re-guessing on every keystroke would fight the user's own choices, so
    // this is keyed on the paste's shape rather than its text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const assigned = new Set(mapping.filter(Boolean) as ImportField[]);
  const missing = IMPORT_FIELDS.filter((f) => f.required && !assigned.has(f.key));
  const mappingReady = sheet.rows.length > 0 && missing.length === 0;

  const resolved = useMemo(() => {
    if (!mappingReady) return [];
    return parseMappedRows(sheet, mapping).map((row) => {
      // Same matcher the importer script uses, so a paste and a scripted
      // import file the same row under the same category.
      const matched = matchCategoryId(row.type, known);
      const categoryId = matched ?? fallbackCategoryId;
      const errors = [...row.errors];
      if (!categoryId) {
        errors.push(`No category matches "${row.type}", create it or pick a fallback below.`);
      }
      // The sheet's own "paid by" wins where it names someone recognisable,
      // so a shared sheet reimburses the person who actually paid rather than
      // whoever the form happens to have selected.
      const rowUserId = matchUserId(row.by, users);
      return {
        ...row,
        categoryId,
        matched: Boolean(matched),
        userId: rowUserId ?? employeeUserId,
        userMatched: Boolean(rowUserId),
        errors,
      };
    });
  }, [sheet, mapping, mappingReady, fallbackCategoryId, known, users, employeeUserId]);

  /**
   * The types in this paste that no category covers.
   *
   * Deduplicated case-insensitively so a sheet writing "Fuel" and "fuel" in
   * different rows offers to create one category rather than two.
   */
  const unmatchedTypes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of resolved) {
      if (row.matched || !row.type) continue;
      const key = row.type.toLowerCase();
      if (!seen.has(key)) seen.set(key, row.type);
    }
    return [...seen.values()];
  }, [resolved]);

  const namedInSheet = resolved.filter((r) => r.userMatched).length;
  const badRows = resolved.filter((r) => r.errors.length > 0);
  const flagged = resolved.filter((r) => r.errors.length === 0 && r.dateNote);
  // Some rows only make sense read day-first and others only month-first, so
  // no single convention fits. Worth saying once at the top rather than
  // leaving it to be inferred from a scattering of per-row notes.
  const mixedDates =
    resolved.length > 0 &&
    resolved.some((r) => r.dateNote?.includes("day-first")) &&
    resolved.some((r) => r.dateNote?.includes("month-first"));
  const total = resolved.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const canImport =
    resolved.length > 0 &&
    badRows.length === 0 &&
    (paidByCompany ? Boolean(vendorAccountId) : Boolean(employeeUserId));

  /**
   * Reads a dropped or chosen file.
   *
   * A CSV becomes text and joins the same path a paste takes. An .xlsx cannot:
   * its cells arrive typed, and flattening a real Date back into "5/8/2026"
   * would hand the guesser an ambiguity the workbook had already resolved. So a
   * workbook is split straight into a sheet, and `workbook` state is what says
   * which of the two is currently loaded.
   *
   * The library is imported here rather than at the top of the file so its
   * ~100KB only loads for someone who actually drops a workbook.
   */
  function readFile(file: File) {
    setError(null);
    setFileName(file.name);

    if (/\.xlsx?$/i.test(file.name)) {
      setText("");
      import("read-excel-file/browser")
        .then(async ({ default: readXlsxFile }) => {
          // The default export returns every sheet. A workbook with a tab per
          // month is the normal shape for expenses, so which tab to import is
          // a question to ask rather than a first-sheet assumption to make.
          const sheets = await readXlsxFile(file);
          setSheetNames(sheets.map((s) => s.sheet));
          setSheetIndex(0);
          setWorkbookSheets(sheets.map((s) => sheetFromWorkbookRows(s.data as unknown[][])));
        })
        .catch(() => {
          setError(
            `Could not read "${file.name}". If it is an old .xls, open it in Excel and save it as .xlsx or CSV.`,
          );
          setFileName(null);
          setWorkbookSheets([]);
          setSheetNames([]);
        });
      return;
    }

    setSheetNames([]);
    setWorkbookSheets([]);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.onerror = () => {
      setError(`Could not read "${file.name}".`);
      setFileName(null);
    };
    reader.readAsText(file);
  }

  function setColumn(index: number, field: ImportField | null) {
    setMapping((prev) => {
      const next = [...prev];
      // Every field except Notes belongs to one column, so pointing a second
      // column at it releases the first rather than silently ignoring one.
      if (field && field !== "notes") {
        for (let i = 0; i < next.length; i++) if (next[i] === field) next[i] = null;
      }
      next[index] = field;
      return next;
    });
  }

  /**
   * Creates a category for every type this paste does not already cover.
   *
   * Deliberately a button rather than something the import does on its own. A
   * typo in a sheet — "Rnet" for "Rent" — would otherwise become a permanent
   * line in the accounts that nobody chose, and the damage is quiet: the
   * expense imports fine and the wrong category only shows up in a report
   * months later. Naming them here, with the list in view, keeps that a
   * decision.
   */
  function createMissingCategories() {
    setError(null);
    start(async () => {
      const created: Option[] = [];
      for (const name of unmatchedTypes) {
        const result = await createExpenseCategory({ name });
        if (!result.ok) {
          setError(`Could not add "${name}": ${result.error}`);
          break;
        }
        if (result.data) created.push(result.data);
      }
      if (created.length > 0) setAdded((prev) => [...prev, ...created]);
      // The new rows exist server-side too, so Settings and the expense form
      // see them without a reload.
      router.refresh();
    });
  }

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
          employeeUserId: paidByCompany ? null : r.userId,
          projectId: projectId || null,
          billableToCustomer: false,
          // The company paying its own supplier owes nobody anything back.
          reimbursable: !paidByCompany,
          vendorAccountId: paidByCompany ? vendorAccountId || null : null,
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
        {/* Asked first, and in the words people actually use. Whose money went
            out decides everything downstream - whether anyone is owed a
            reimbursement, and which settled state the row ends in - and it was
            previously spread across three controls that each told half of it. */}
        <fieldset className="mb-5">
          <legend className="text-sm font-medium">Whose money paid for these?</legend>
          <p className="mt-1 text-xs text-muted-foreground">
            This decides who gets the money back when the expenses are settled.
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                !paidByCompany ? "border-primary bg-primary/5" : "hover:border-primary/40"
              }`}
            >
              <input
                type="radio"
                name="whopaid"
                className="mt-1"
                checked={!paidByCompany}
                onChange={() => setPaidByCompany(false)}
              />
              <span className="text-sm">
                <span className="font-medium">Someone paid from their own pocket</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  The company owes them the money back.
                </span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 ${
                paidByCompany ? "border-primary bg-primary/5" : "hover:border-primary/40"
              }`}
            >
              <input
                type="radio"
                name="whopaid"
                className="mt-1"
                checked={paidByCompany}
                onChange={() => setPaidByCompany(true)}
              />
              <span className="text-sm">
                <span className="font-medium">The company paid directly</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Straight to the shop or supplier. Nobody is owed anything.
                </span>
              </span>
            </label>
          </div>

          <div className="mt-3 max-w-md">
            {paidByCompany ? (
              <Field
                label="Paid to"
                required
                hint="The shop or supplier the money went to."
              >
                <Select
                  value={vendorAccountId}
                  onChange={(e) => setVendorAccountId(e.target.value)}
                >
                  <option value="">Choose a supplier…</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field
                label="Who to pay back"
                required
                hint={
                  namedInSheet > 0
                    ? `${namedInSheet} of ${resolved.length} rows name their own person in the sheet. This covers the rest.`
                    : "Used for every row. Map a Paid by column to take the name from the sheet instead."
                }
              >
                <Select
                  value={employeeUserId}
                  onChange={(e) => setEmployeeUserId(e.target.value)}
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.fullName}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Currency">
            <Select value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>{c.code}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project (optional)">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None - general overhead</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-4 space-y-3">
          <label
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) readFile(file);
            }}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-input bg-muted/20 hover:border-primary/40"
            }`}
          >
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground" />
            {fileName ? (
              <>
                <span className="text-sm font-medium">{fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {sheet.rows.length} row{sheet.rows.length === 1 ? "" : "s"} read. Choose another
                  file to replace it.
                </span>
              </>
            ) : (
              <>
                <span className="text-sm font-medium">
                  Drop an Excel file or CSV here, or click to choose one
                </span>
                <span className="text-xs text-muted-foreground">
                  .xlsx straight out of Excel, or a CSV from Google Sheets
                  (File → Download → Comma-separated values).
                </span>
              </>
            )}
            <input
              type="file"
              accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values,text/plain"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) readFile(file);
                // Cleared so choosing the same file twice still fires a change,
                // which is what someone re-picking a file they have just edited
                // expects.
                e.target.value = "";
              }}
            />
          </label>

          {/* A workbook kept per month is the usual shape, so which tab to
              import is asked rather than assumed. Without this the first tab
              would import silently and the other eleven would look imported. */}
          {sheetNames.length > 1 && (
            <Field
              label="Sheet"
              hint={`This workbook has ${sheetNames.length} sheets. One is imported at a time.`}
            >
              <Select
                value={String(sheetIndex)}
                onChange={(e) => setSheetIndex(Number(e.target.value))}
              >
                {sheetNames.map((name, i) => (
                  <option key={name} value={i}>
                    {name} ({workbookSheets[i]?.rows.length ?? 0} rows)
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {/* Pasting still works, but it is the fallback now: a file is what
              people actually have, and a ten-row textarea sitting open invited
              them to hand-retype what they could have handed over whole. */}
          <details open={!fileName && text.trim() !== ""}>
            <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
              Or paste the rows instead
            </summary>
            <div className="mt-2">
              <Field
                label="Rows"
                hint="Whatever order your columns are already in - you match them up in the next step. A header row is detected."
              >
                <Textarea
                  rows={8}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setFileName(null);
                    setWorkbookSheets([]);
                    setSheetNames([]);
                  }}
                  placeholder={SAMPLE}
                  className="font-mono text-xs"
                />
              </Field>
            </div>
          </details>
        </div>

        {unmatchedTypes.length > 0 && (
          <div className="mt-4 rounded-md border border-dashed bg-muted/30 p-3">
            <p className="text-sm font-medium">
              {unmatchedTypes.length} type{unmatchedTypes.length === 1 ? "" : "s"} in this
              sheet {unmatchedTypes.length === 1 ? "has" : "have"} no category
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {unmatchedTypes.join(", ")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Add them as categories, or send every one of these rows to a single fallback
              below. Check the spelling first - a category is hard to unpick once expenses
              are filed against it.
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={createMissingCategories}
              disabled={pending}
            >
              <Plus className="h-4 w-4" />
              {pending
                ? "Adding…"
                : `Add ${unmatchedTypes.length} categor${unmatchedTypes.length === 1 ? "y" : "ies"}`}
            </Button>
          </div>
        )}

        {mappingReady && !resolved.every((r) => r.matched) && (
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
                {known.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </Card>

      {sheet.rows.length > 0 && (
        <Card>
          <div className="border-b p-4">
            <h2 className="text-sm font-medium">Which column is which?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Set from your header where it could be read, and from the values where it could
              not. Correct anything it got wrong - columns left on Ignore are not imported.
            </p>
            {missing.length > 0 && (
              <div className="mt-3">
                <Alert tone="warning">
                  Still to point at a column: {missing.map((f) => f.label).join(", ")}.
                </Alert>
              </div>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  {Array.from({ length: sheet.width }, (_, i) => (
                    <TH key={i} className="min-w-[11rem] align-top">
                      <Select
                        value={mapping[i] ?? ""}
                        onChange={(e) => setColumn(i, (e.target.value || null) as ImportField | null)}
                        className="w-full font-normal"
                      >
                        <option value="">Ignore this column</option>
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}{f.required ? " *" : ""}
                          </option>
                        ))}
                      </Select>
                      {sheet.header && (
                        <p className="mt-1 truncate text-xs font-normal normal-case text-muted-foreground">
                          {sheet.header[i] || "(unnamed)"}
                        </p>
                      )}
                    </TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {/* A few real rows, so a mapping can be checked against the
                    values it will actually read rather than against a name. */}
                {sheet.rows.slice(0, 3).map((row) => (
                  <TR key={row.line}>
                    {Array.from({ length: sheet.width }, (_, i) => (
                      <TD
                        key={i}
                        className={
                          mapping[i]
                            ? "max-w-[16rem] truncate text-sm"
                            : "max-w-[16rem] truncate text-sm text-muted-foreground/50 line-through"
                        }
                      >
                        {row.cells[i] || "—"}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          {sheet.rows.length > 3 && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              Showing 3 of {sheet.rows.length} rows.
            </p>
          )}
        </Card>
      )}

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
            {mixedDates && (
              <Badge tone="warning">
                <AlertTriangle className="h-3 w-3" /> mixed date order
              </Badge>
            )}
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                onClick={() => { setText(""); setFileName(null); setWorkbookSheets([]); setSheetNames([]); }}
                disabled={pending}
              >
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
                <TH>{paidByCompany ? "Paid to" : "Pay back"}</TH>
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
                        → {known.find((c) => c.id === row.categoryId)?.name}
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
                  <TD className="whitespace-nowrap text-sm">
                    {paidByCompany ? (
                      <span className="text-muted-foreground">
                        {vendors.find((v) => v.id === vendorAccountId)?.name ?? "the company"}
                      </span>
                    ) : (
                      users.find((u) => u.id === row.userId)?.fullName ?? "—"
                    )}
                    {/* Only worth saying when the sheet named someone and this
                        is not them: silence otherwise reads as agreement. */}
                    {!paidByCompany && row.by && !row.userMatched && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">
                        &quot;{row.by}&quot; not matched
                      </p>
                    )}
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
