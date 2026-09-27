"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import {
  Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Select, Textarea,
  Table, THead, TBody, TR, TH, TD,
} from "@/components/ui";
import { parseDelimited, guessMapping } from "@/lib/parse-delimited";
import { importPartnerLeads, type PartnerImportResult } from "@/server/partner-leads";

/** What a column can be. First and last name are the only ones required. */
const FIELDS = [
  { key: "firstName", label: "First name", required: true, aliases: ["first", "first name", "given name", "fname", "forename"] },
  { key: "lastName", label: "Last name", required: true, aliases: ["last", "last name", "surname", "lname", "family name"] },
  { key: "companyName", label: "Company", aliases: ["company", "company name", "organisation", "organization", "account", "business"] },
  { key: "jobTitle", label: "Job title", aliases: ["title", "job title", "designation", "position", "role"] },
  { key: "email", label: "Email", aliases: ["email", "email address", "e-mail", "mail"] },
  { key: "phone", label: "Phone", aliases: ["phone", "phone number", "mobile", "contact number", "tel", "telephone"] },
  { key: "whatsapp", label: "WhatsApp", aliases: ["whatsapp", "whats app", "wa"] },
  { key: "city", label: "City", aliases: ["city", "town"] },
  { key: "country", label: "Country", aliases: ["country"] },
  { key: "website", label: "Website", aliases: ["website", "web", "url", "site"] },
  { key: "description", label: "Notes", aliases: ["notes", "description", "comment", "comments", "remarks"] },
] as const;

const SAMPLE = `First Name,Last Name,Company,Email,Phone
Asad,Khan,Sultana Medical Center,asad@sultana.pk,+92 300 1234567
Sara,Ali,Rehman Foods,sara@rehmanfoods.pk,+92 321 7654321`;

/**
 * A partner's list, imported as leads of theirs.
 *
 * The columns are mapped by hand, since a list is whatever shape its source
 * made it. People already in our records - as a lead or a contact, theirs or
 * anybody's - and people repeated in the file are left out and listed rather
 * than failing the file; who a known person is, the partner is told only when
 * the record is their own.
 */
export function PartnerLeadImport() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PartnerImportResult | null>(null);

  const parsed = useMemo(() => parseDelimited(text), [text]);

  useEffect(() => {
    if (parsed.headers.length === 0 || touched) return;
    setMapping(guessMapping(parsed.headers, FIELDS.map((f) => ({ key: f.key, aliases: [...f.aliases] }))));
  }, [parsed.headers, touched]);

  const rows = useMemo(() => {
    const index: Record<string, number> = {};
    parsed.headers.forEach((h, i) => { index[h] = i; });
    return parsed.rows.map((cells) => {
      const lead: Record<string, string> = {};
      for (const f of FIELDS) {
        const column = mapping[f.key];
        if (column !== undefined && index[column] !== undefined) lead[f.key] = cells[index[column]] ?? "";
      }
      return lead;
    });
  }, [parsed, mapping]);

  const missing = FIELDS.filter((f) => "required" in f && f.required && !mapping[f.key]);

  function onFile(file: File) {
    setFileName(file.name);
    setTouched(false);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function submit() {
    setError(null);
    setOutcome(null);
    start(async () => {
      const result = await importPartnerLeads(rows as never);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOutcome(result.data);
      // The file is done with: importing it again would only list everybody as known.
      setText("");
      setFileName(null);
    });
  }

  return (
    <div className="space-y-5">
      {outcome && (
        <Alert tone={outcome.created > 0 ? "success" : "warning"}>
          <div className="space-y-2">
            <p className="font-medium">
              {outcome.created > 0 ? `Imported ${outcome.created} lead${outcome.created === 1 ? "" : "s"}.` : "Nothing was imported."}
              {outcome.skipped.length > 0 &&
                ` ${outcome.skipped.length} row${outcome.skipped.length === 1 ? " was" : "s were"} left out.`}
            </p>
            {outcome.skipped.length > 0 && (
              <ul className="space-y-1 text-sm">
                {outcome.skipped.map((s) => (
                  <li key={s.row}>Row {s.row}{s.name ? `, ${s.name}` : ""}: {s.reason}</li>
                ))}
              </ul>
            )}
            <Button asChild size="sm" variant="outline">
              <a href="/portal/leads">Go to your leads</a>
            </Button>
          </div>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Paste or upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm hover:border-primary/40">
            <FileSpreadsheet className="h-4 w-4" />
            {fileName ?? "Choose a CSV file"}
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
          <Textarea
            rows={8}
            value={text}
            onChange={(e) => { setText(e.target.value); setTouched(false); }}
            placeholder={SAMPLE}
            aria-label="Paste your list"
          />
        </CardContent>
      </Card>

      {parsed.headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · Which column is which</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map((f) => (
              <Field key={f.key} label={f.label} required={"required" in f && f.required}>
                <Select
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => {
                    setTouched(true);
                    setMapping((m) => ({ ...m, [f.key]: e.target.value }));
                  }}
                  aria-label={`Column for ${f.label}`}
                >
                  <option value="">Not in this file</option>
                  {parsed.headers.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </Select>
              </Field>
            ))}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3 · Check, then import</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <THead>
                <TR>
                  <TH>Row</TH>
                  <TH>Name</TH>
                  <TH priority="secondary">Company</TH>
                  <TH>Email</TH>
                  <TH priority="secondary">Phone</TH>
                </TR>
              </THead>
              <TBody>
                {rows.slice(0, 50).map((r, i) => (
                  <TR key={i}>
                    <TD className="tabular text-sm">{i + 1}</TD>
                    <TD className="text-sm">{`${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "—"}</TD>
                    <TD className="text-sm" priority="secondary">{r.companyName || "—"}</TD>
                    <TD className="text-sm">{r.email || "—"}</TD>
                    <TD className="text-sm" priority="secondary">{r.phone || r.whatsapp || "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {rows.length > 50 && (
              <p className="px-5 pt-3 text-xs text-muted-foreground">Showing the first 50 of {rows.length}.</p>
            )}
          </CardContent>
        </Card>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
      {missing.length > 0 && parsed.headers.length > 0 && (
        <Alert tone="warning">Say which column holds {missing.map((f) => f.label.toLowerCase()).join(" and ")}.</Alert>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending || rows.length === 0 || missing.length > 0}>
          <Upload className="h-4 w-4" />
          {pending ? "Importing…" : rows.length ? `Import ${rows.length} lead${rows.length === 1 ? "" : "s"}` : "Import"}
        </Button>
      </div>
    </div>
  );
}
