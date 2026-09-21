"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardContent, Button, Alert, Field, Select,
  Input, Textarea, Table, THead, TBody, TR, TH, TD, Badge,
} from "@/components/ui";
import { parseDelimited, guessMapping } from "@/lib/parse-delimited";
import { importCampaignMembers, type ImportSummary } from "@/server/campaign-members";

/**
 * The member fields an incoming column can be pointed at.
 *
 * `aliases` are what other systems and hand-made sheets actually call these,
 * used only to pre-select a guess, which stays visible and editable.
 */
const FIELDS = [
  { key: "firstName", label: "First name", required: true,
    aliases: ["first", "first name", "given name", "fname", "forename", "name"] },
  { key: "lastName", label: "Last name",
    aliases: ["last", "last name", "surname", "lname", "family name"] },
  { key: "email", label: "Email",
    aliases: ["email", "email address", "e-mail", "mail"] },
  { key: "phone", label: "Contact number",
    aliases: ["phone", "phone number", "mobile", "contact number", "tel", "telephone", "cell"] },
  { key: "whatsapp", label: "WhatsApp",
    aliases: ["whatsapp", "whats app", "wa", "whatsapp number"] },
  { key: "companyName", label: "Company",
    aliases: ["company", "company name", "organisation", "organization", "business", "firm"] },
  { key: "website", label: "Website",
    aliases: ["website", "url", "web", "site", "domain"] },
  { key: "businessType", label: "Business type",
    aliases: ["business type", "industry", "sector", "category", "type"] },
  { key: "companySize", label: "Company size",
    aliases: ["size", "company size", "employees", "headcount", "employee count"] },
  { key: "street", label: "Street",
    aliases: ["street", "address", "address line 1", "address1"] },
  { key: "city", label: "City", aliases: ["city", "town"] },
  { key: "state", label: "State", aliases: ["state", "province", "region"] },
  { key: "postalCode", label: "Postal code",
    aliases: ["postal code", "postcode", "zip", "zip code", "pin"] },
  { key: "country", label: "Country", aliases: ["country", "nation"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "comment", "comments", "remarks"] },
];

const MAX_ROWS = 5000;

/**
 * Import a marketing list from a spreadsheet.
 *
 * The mapping step is the point. A list arrives from an event organiser, a
 * bought file or somebody's own sheet, and its columns are whatever they are —
 * so which column is which has to be part of the import rather than a rule
 * baked into the parser.
 *
 * Unlike the lead importer, this one does not refuse the whole file over a bad
 * row. A marketing list of two thousand names will have blank lines in it, and
 * rejecting all of them because of three is not useful; rows without a first
 * name are counted as skipped and reported.
 *
 * Matching is on email: somebody already on the list is updated rather than
 * added again, because the same people arrive in file after file.
 */
export function CampaignMemberImportForm({ businessTypes, companySizes }: {
  businessTypes: { value: string; label: string }[];
  companySizes: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const [source, setSource] = useState("");

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const parsed = useMemo(() => parseDelimited(text), [text]);

  // Re-guess when new headers arrive, but never overwrite a mapping somebody
  // has adjusted themselves.
  useEffect(() => {
    if (parsed.headers.length === 0 || touched) return;
    setMapping(guessMapping(parsed.headers, FIELDS));
  }, [parsed.headers, touched]);

  const rows = useMemo(() => {
    if (!parsed.rows.length) return [];
    return parsed.rows.map((row) => {
      const out: Record<string, string> = {};
      for (const field of FIELDS) {
        const header = mapping[field.key];
        if (!header) continue;
        const index = parsed.headers.indexOf(header);
        if (index >= 0) out[field.key] = (row[index] ?? "").trim();
      }
      if (source.trim()) out.source = source.trim();
      return out;
    });
  }, [parsed, mapping, source]);

  const usable = rows.filter((r) => (r.firstName ?? "").trim() !== "");
  const blank = rows.length - usable.length;
  const withEmail = usable.filter((r) => (r.email ?? "").trim() !== "").length;
  const mapped = Boolean(mapping.firstName);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setTouched(false);
    setText(await file.text());
    event.target.value = "";
  }

  function onImport() {
    setError(null);
    setSummary(null);
    start(async () => {
      const result = await importCampaignMembers(usable as never);
      if (result.ok) {
        setSummary(result.data);
        setText("");
        setFileName(null);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      {summary && (
        <Alert tone="success">
          <p className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            {summary.added} added, {summary.updated} updated
            {summary.skipped > 0 && `, ${summary.skipped} skipped`}.
          </p>
          <p className="mt-1 text-sm">
            {summary.updated > 0 &&
              "Updated rows already had that email address, so their details were topped up rather than duplicated. "}
            <button type="button" className="underline" onClick={() => router.push("/campaign-members")}>
              Open the list
            </button>
          </p>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4" /> 1. The file
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a CSV, or paste the rows straight from a spreadsheet. The first line must be the
            column headings.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button asChild variant="secondary">
              <label className="cursor-pointer">
                <Upload className="h-4 w-4" /> Choose a file
                <input
                  id="member-file"
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv"
                  hidden
                  onChange={onFile}
                />
              </label>
            </Button>
            {fileName && <span className="text-sm text-muted-foreground">{fileName}</span>}
          </div>

          <Field label="…or paste the rows here">
            <Textarea
              id="member-paste"
              rows={5}
              value={text}
              onChange={(e) => { setText(e.target.value); setFileName(null); setTouched(false); }}
              placeholder={"First name,Last name,Email,Company\nAyesha,Malik,ayesha@example.com,Meridian Foods"}
              className="font-mono text-xs"
            />
          </Field>
        </CardContent>
      </Card>

      {parsed.headers.length > 0 && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2. Which column is which</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                We have guessed from the headings. Correct anything that is wrong, and leave out
                what you do not want.
              </p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  required={field.required}
                  error={field.required && !mapping[field.key] ? "Needed" : undefined}
                >
                  <Select
                    id={`map-${field.key}`}
                    value={mapping[field.key] ?? ""}
                    onChange={(e) => {
                      setTouched(true);
                      setMapping((prev) => ({ ...prev, [field.key]: e.target.value }));
                    }}
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

          <Card>
            <CardHeader>
              <CardTitle>3. Applies to every row</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Where this list came from"
                help="Recorded against everyone in the file, so you can tell later which list somebody came off."
              >
                <Input
                  id="import-source"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  maxLength={100}
                  placeholder="Trade show, October 2026"
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Check, then import</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="neutral">{rows.length} rows read</Badge>
                <Badge tone={usable.length ? "success" : "warning"}>{usable.length} usable</Badge>
                <Badge tone="neutral">{withEmail} with an email address</Badge>
                {blank > 0 && <Badge tone="warning">{blank} without a first name</Badge>}
              </div>

              {blank > 0 && (
                <Alert tone="info">
                  {blank === 1 ? "One row has" : `${blank} rows have`} no first name and will be
                  skipped. The rest still import.
                </Alert>
              )}

              {usable.length > MAX_ROWS && (
                <Alert tone="danger">
                  <AlertTriangle className="mr-1 inline h-4 w-4" />
                  That is {usable.length} rows. Import up to {MAX_ROWS.toLocaleString()} at a time.
                </Alert>
              )}

              {usable.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Name</TH>
                        <TH>Email</TH>
                        <TH>Company</TH>
                        <TH>Phone</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {usable.slice(0, 5).map((row, i) => (
                        <TR key={i}>
                          <TD className="text-sm">{`${row.firstName} ${row.lastName ?? ""}`.trim()}</TD>
                          <TD className="text-sm">{row.email || "—"}</TD>
                          <TD className="text-sm">{row.companyName || "—"}</TD>
                          <TD className="text-sm">{row.phone || "—"}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                  {usable.length > 5 && (
                    <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                      …and {usable.length - 5} more.
                    </p>
                  )}
                </div>
              )}

              <p className="text-sm text-muted-foreground">
                Anyone whose email address is already on the list is updated rather than added
                again. Blank cells never overwrite details you already have.
              </p>

              <Button
                onClick={onImport}
                disabled={pending || !mapped || usable.length === 0 || usable.length > MAX_ROWS}
              >
                {pending ? "Importing…" : `Import ${usable.length} ${usable.length === 1 ? "person" : "people"}`}
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {(businessTypes.length > 0 || companySizes.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>What the type and size columns should say</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Values that do not match one of these are still imported, and show as typed. Add new
              ones in Settings or on the member form.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Business type</p>
              <p className="text-muted-foreground">
                {businessTypes.map((t) => t.value).join(", ") || "None set up yet"}
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Company size</p>
              <p className="text-muted-foreground">
                {companySizes.map((s) => s.value).join(", ") || "None set up yet"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
