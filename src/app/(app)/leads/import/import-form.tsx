"use client";

import { useState, useMemo, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Upload, ArrowLeft, FileSpreadsheet, AlertTriangle } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardContent, Button, Alert, Field, Select,
  Textarea, Table, THead, TBody, TR, TH, TD, Badge,
} from "@/components/ui";
import { parseDelimited, guessMapping } from "@/lib/parse-delimited";
import { createLeadsBulk } from "@/server/crm";

type Option = { id: string; name?: string; fullName?: string; displayName?: string };

/**
 * The lead fields an incoming column can be pointed at.
 *
 * `aliases` are what other systems and hand-made sheets actually call these —
 * used only to pre-select a guess, which is always visible and always editable.
 */
const FIELDS: {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
  hint?: string;
}[] = [
  { key: "firstName", label: "First name", required: true,
    aliases: ["first", "first name", "given name", "fname", "forename"] },
  { key: "lastName", label: "Last name", required: true,
    aliases: ["last", "last name", "surname", "lname", "family name"] },
  { key: "companyName", label: "Company",
    aliases: ["company", "company name", "organisation", "organization", "account", "business"] },
  { key: "jobTitle", label: "Job title",
    aliases: ["title", "job title", "designation", "position", "role"] },
  { key: "email", label: "Email",
    aliases: ["email", "email address", "e-mail", "mail"] },
  { key: "phone", label: "Phone",
    aliases: ["phone", "phone number", "mobile", "contact number", "tel", "telephone"] },
  { key: "whatsapp", label: "WhatsApp",
    aliases: ["whatsapp", "whats app", "wa"] },
  { key: "industry", label: "Industry",
    aliases: ["industry", "sector", "vertical"] },
  { key: "leadSource", label: "Lead source",
    aliases: ["source", "lead source", "channel", "origin"] },
  { key: "estimatedValue", label: "Estimated value",
    aliases: ["value", "estimated value", "deal size", "amount", "budget", "potential"],
    hint: "Numbers only - currency symbols and separators are stripped." },
  { key: "rating", label: "Rating",
    aliases: ["rating", "temperature", "priority"],
    hint: "Hot, Warm or Cold. Anything else is left unrated." },
  { key: "description", label: "Notes",
    aliases: ["notes", "description", "comment", "comments", "remarks"] },
];

const SAMPLE = `First Name,Last Name,Company,Email,Phone,Estimated Value
Asad,Khan,Sultana Medical Center,asad@sultana.pk,+92 300 1234567,120000
Sara,Ali,Rehman Foods,sara@rehmanfoods.pk,+92 321 7654321,85000`;

/** Money cells arrive as "Rs 120,000" far more often than as bare digits. */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Only the three ratings the schema accepts; anything else is left unset. */
function parseRating(raw: string): "HOT" | "WARM" | "COLD" | null {
  const v = raw.trim().toUpperCase();
  return v === "HOT" || v === "WARM" || v === "COLD" ? v : null;
}

const SOURCES = [
  "Website", "Referral", "Partner", "Campaign", "Cold Call",
  "Trade Show", "Social Media", "Inbound Email", "Other",
];

/**
 * Import leads from a spreadsheet, with the columns mapped by hand.
 *
 * Four steps, and the second one is the point: paste or upload, say which
 * column is which, set what applies to all of them, then check the preview
 * before anything is written.
 *
 * The expense importer next door assumes fixed columns in a fixed order, which
 * works because that sheet is ours. A lead list comes from a partner, an event
 * organiser or a bought list, and its columns are whatever they are — so the
 * mapping has to be part of the import rather than a rule baked into the parser.
 *
 * Nothing is written until every row passes. A half-finished import leaves
 * someone working out which prospects already exist, which is worse than a
 * rejected file they can fix and paste again.
 */
export function LeadImportForm({
  users,
  campaigns,
  partners,
  currentUserId,
}: {
  users: Option[];
  campaigns: Option[];
  partners: Option[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);

  // Applied to every row, because these are ours to decide rather than the
  // source sheet's: who owns the leads, and what they are attributed to.
  const [ownerUserId, setOwnerUserId] = useState(currentUserId);
  const [campaignId, setCampaignId] = useState("");
  const [referredByPartnerId, setReferredByPartnerId] = useState("");
  const [defaultSource, setDefaultSource] = useState("");

  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => parseDelimited(text), [text]);

  // Re-guess whenever a new file or paste changes the headers, but never
  // overwrite a mapping the person has adjusted themselves.
  useEffect(() => {
    if (parsed.headers.length === 0 || touched) return;
    setMapping(guessMapping(parsed.headers, FIELDS));
  }, [parsed.headers, touched]);

  const columnIndex = useMemo(() => {
    const byName: Record<string, number> = {};
    parsed.headers.forEach((h, i) => { byName[h] = i; });
    return byName;
  }, [parsed.headers]);

  /** Builds the lead payloads plus a per-row list of what is wrong with them. */
  const rows = useMemo(() => {
    if (parsed.rows.length === 0) return [];

    const cell = (row: string[], field: string) => {
      const header = mapping[field];
      if (!header) return "";
      const i = columnIndex[header];
      return i === undefined ? "" : (row[i] ?? "").trim();
    };

    return parsed.rows.map((row, i) => {
      const firstName = cell(row, "firstName");
      const lastName = cell(row, "lastName");
      const estimatedRaw = cell(row, "estimatedValue");
      const ratingRaw = cell(row, "rating");

      const errors: string[] = [];
      if (!firstName) errors.push("First name is required");
      if (!lastName) errors.push("Last name is required");

      const email = cell(row, "email");
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        errors.push(`Not an email address: ${email}`);
      }

      const estimatedValue = estimatedRaw ? parseNumber(estimatedRaw) : null;
      if (estimatedRaw && estimatedValue === null) {
        errors.push(`Not a number: ${estimatedRaw}`);
      }

      const rating = ratingRaw ? parseRating(ratingRaw) : null;

      return {
        line: i + 2, // +1 for the header row, +1 because people count from one.
        errors,
        // Warnings do not block the import; they say what was dropped.
        warnings: ratingRaw && !rating ? [`Rating ignored: ${ratingRaw}`] : [],
        lead: {
          firstName,
          lastName,
          companyName: cell(row, "companyName") || null,
          jobTitle: cell(row, "jobTitle") || null,
          email: email || null,
          phone: cell(row, "phone") || null,
          whatsapp: cell(row, "whatsapp") || null,
          industry: cell(row, "industry") || null,
          leadSource: cell(row, "leadSource") || defaultSource || null,
          campaignId: campaignId || null,
          referredByPartnerId: referredByPartnerId || null,
          ownerUserId,
          rating,
          estimatedValue,
          description: cell(row, "description") || null,
          nextFollowUpAt: null,
        },
      };
    });
  }, [parsed.rows, mapping, columnIndex, ownerUserId, campaignId, referredByPartnerId, defaultSource]);

  const badRows = rows.filter((r) => r.errors.length > 0);
  const missingRequired = FIELDS.filter((f) => f.required && !mapping[f.key]);
  const canImport =
    rows.length > 0 && badRows.length === 0 && missingRequired.length === 0 && !pending;

  function onFile(file: File) {
    setFileName(file.name);
    setTouched(false);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function submit() {
    setError(null);
    start(async () => {
      const result = await createLeadsBulk(rows.map((r) => r.lead) as never);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push("/leads");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" className="px-0">
        <a href="/leads"><ArrowLeft className="h-4 w-4" /> Back to leads</a>
      </Button>

      {/* --------------------------------------------------- 1. the data */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1 · Paste or upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-card px-3 py-2 text-sm hover:border-primary/40">
              <FileSpreadsheet className="h-4 w-4" />
              {fileName ?? "Choose a CSV file"}
              <input
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onFile(f);
                }}
              />
            </label>
            <span className="text-xs text-muted-foreground">
              From Google Sheets: File → Download → Comma-separated values. Or select
              the cells there and paste them below.
            </span>
          </div>

          <Textarea
            rows={7}
            value={text}
            onChange={(e) => { setText(e.target.value); setTouched(false); setFileName(null); }}
            placeholder={SAMPLE}
            className="font-mono text-xs"
          />

          {text.trim() && parsed.headers.length === 0 && (
            <Alert tone="warning">
              Nothing readable in that. The first row should be the column headings.
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------ 2. the mapping */}
      {parsed.headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2 · Match the columns</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              {parsed.headers.length} column{parsed.headers.length === 1 ? "" : "s"} found.
              Matches are guessed from the headings - change any that are wrong.
              Anything left as &ldquo;Do not import&rdquo; is ignored.
            </p>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f) => (
                <Field
                  key={f.key}
                  label={f.required ? `${f.label} *` : f.label}
                  help={f.hint}
                >
                  <Select
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => {
                      setTouched(true);
                      setMapping((m) => ({ ...m, [f.key]: e.target.value }));
                    }}
                    aria-invalid={f.required && !mapping[f.key] ? true : undefined}
                  >
                    <option value="">Do not import</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </Select>
                </Field>
              ))}
            </div>

            {missingRequired.length > 0 && (
              <Alert tone="warning">
                Still need a column for{" "}
                {missingRequired.map((f) => f.label.toLowerCase()).join(" and ")}.
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------ 3. what applies to them all */}
      {parsed.headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">3 · Applies to every row</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Owner" help="Who these leads belong to and will follow up.">
              <Select value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName ?? u.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Campaign" help="If this list came from one marketing push.">
              <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </Field>

            <Field label="Referred by" help="Credits a partner for the whole list.">
              <Select
                value={referredByPartnerId}
                onChange={(e) => setReferredByPartnerId(e.target.value)}
              >
                <option value="">None</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>{p.displayName ?? p.name}</option>
                ))}
              </Select>
            </Field>

            <Field
              label="Default source"
              help="Used for any row whose own source column is empty."
            >
              <Select value={defaultSource} onChange={(e) => setDefaultSource(e.target.value)}>
                <option value="">Not stated</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------- 4. the preview */}
      {rows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              4 · Check {rows.length} row{rows.length === 1 ? "" : "s"}
            </CardTitle>
            {badRows.length > 0 && (
              <Badge tone="danger">
                {badRows.length} row{badRows.length === 1 ? "" : "s"} to fix
              </Badge>
            )}
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Row</TH>
                    <TH>Name</TH>
                    <TH>Company</TH>
                    <TH>Email</TH>
                    <TH>Phone</TH>
                    <TH className="text-right">Value</TH>
                    <TH>Problem</TH>
                  </TR>
                </THead>
                <TBody>
                  {/* Capped: a 500-row preview is unreadable and slow to render.
                      Every row is still checked - the count above is the truth. */}
                  {rows.slice(0, 50).map((r) => (
                    <TR key={r.line}>
                      <TD className="text-xs text-muted-foreground">{r.line}</TD>
                      <TD>{[r.lead.firstName, r.lead.lastName].filter(Boolean).join(" ") || "—"}</TD>
                      <TD>{r.lead.companyName ?? "—"}</TD>
                      <TD>{r.lead.email ?? "—"}</TD>
                      <TD>{r.lead.phone ?? "—"}</TD>
                      <TD className="text-right tabular">
                        {r.lead.estimatedValue?.toLocaleString() ?? "—"}
                      </TD>
                      <TD className="text-xs">
                        {r.errors.length > 0 ? (
                          <span className="text-destructive">{r.errors.join("; ")}</span>
                        ) : r.warnings.length > 0 ? (
                          <span className="text-amber-600">{r.warnings.join("; ")}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            {rows.length > 50 && (
              <p className="px-5 pt-3 text-xs text-muted-foreground">
                Showing the first 50. All {rows.length} are checked and will be imported.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert tone="danger">
          <span className="whitespace-pre-line">{error}</span>
        </Alert>
      )}

      {badRows.length > 0 && (
        <Alert tone="warning">
          <AlertTriangle className="mr-1 inline h-4 w-4" />
          Nothing is imported while any row has a problem - fix them in the sheet and
          paste again, so you never have to work out which half already landed.
        </Alert>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={!canImport}>
          <Upload className="h-4 w-4" />
          {pending
            ? "Importing…"
            : rows.length > 0
              ? `Import ${rows.length} lead${rows.length === 1 ? "" : "s"}`
              : "Import"}
        </Button>
        <Button asChild variant="outline"><a href="/leads">Cancel</a></Button>
      </div>
    </div>
  );
}
