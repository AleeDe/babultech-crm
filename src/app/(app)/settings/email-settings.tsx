"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Eye, Send, Palette } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Input, Textarea, Button, Alert, Field, Badge,
} from "@/components/ui";
import { saveEmailSettings, previewEmail, sendTestEmail, uploadLogo } from "@/server/email";

export interface EmailSettingsValues {
  companyName: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  addressLine: string | null;
  brandColor: string;
  brandColorDark: string;
  textColor: string;
  mutedColor: string;
  backgroundColor: string;
  quotationSubject: string;
  quotationBody: string;
  invoiceSubject: string;
  invoiceBody: string;
  emailFooter: string;
}

const PLACEHOLDERS = [
  { token: "{{contactFirstName}}", meaning: "the recipient's first name" },
  { token: "{{documentNumber}}", meaning: "QUO-… or INV-…" },
  { token: "{{companyName}}", meaning: "your company name" },
  { token: "{{expiryDate}}", meaning: "quotations only" },
  { token: "{{dueDate}}", meaning: "invoices only" },
];

/**
 * Branding and wording for outbound email.
 *
 * The preview renders the real template in an iframe rather than approximating
 * it, because the point of a preview is to catch a wrong colour or a broken
 * sentence before a customer sees it — an approximation would hide exactly the
 * mistakes worth catching.
 */
export function EmailSettingsPanel({ values }: { values: EmailSettingsValues }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [testSent, setTestSent] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  function uploadNow(file: File) {
    setError(null);
    setUploading(true);

    const formData = new FormData();
    formData.set("logo", file);

    start(async () => {
      const result = await uploadLogo(formData);
      setUploading(false);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  function save(formData: FormData) {
    setError(null);
    setSaved(false);

    const read = (name: string) => String(formData.get(name) ?? "").trim();

    start(async () => {
      const result = await saveEmailSettings({
        companyName: read("companyName"),
        logoUrl: read("logoUrl") || null,
        websiteUrl: read("websiteUrl") || null,
        supportEmail: read("supportEmail") || null,
        supportPhone: read("supportPhone") || null,
        addressLine: read("addressLine") || null,
        brandColor: read("brandColor"),
        brandColorDark: read("brandColorDark"),
        textColor: read("textColor"),
        mutedColor: read("mutedColor"),
        backgroundColor: read("backgroundColor"),
        quotationSubject: read("quotationSubject"),
        quotationBody: read("quotationBody"),
        invoiceSubject: read("invoiceSubject"),
        invoiceBody: read("invoiceBody"),
        emailFooter: read("emailFooter"),
      });

      if (result.ok) {
        setSaved(true);
        setPreview(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function showPreview(kind: "quotation" | "invoice") {
    setError(null);
    start(async () => {
      const html = await previewEmail(kind);
      setPreview(html);
    });
  }

  function sendTest(kind: "quotation" | "invoice") {
    setError(null);
    setTestSent(null);
    start(async () => {
      const result = await sendTestEmail(kind);
      if (result.ok) setTestSent(`Test ${kind} sent to your own address.`);
      else setError(result.error);
    });
  }

  const swatch = (name: keyof EmailSettingsValues, label: string, hint?: string) => (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <input
          type="color"
          defaultValue={String(values[name] ?? "#000000")}
          onChange={(e) => {
            const text = document.querySelector<HTMLInputElement>(`input[name="${name}"]`);
            if (text) text.value = e.target.value.toUpperCase();
          }}
          aria-label={`${label} colour picker`}
          className="h-9 w-12 shrink-0 cursor-pointer rounded border border-input bg-card p-1"
        />
        <Input
          name={name}
          defaultValue={String(values[name] ?? "")}
          className="font-mono text-xs uppercase"
          placeholder="#00B8A4"
        />
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Field>
  );

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-muted-foreground" />
          Email branding and templates
        </CardTitle>
        <CardDescription>
          What customers see when a quotation or invoice arrives. Preview before saving - this is
          the same template that goes out.
        </CardDescription>
      </CardHeader>

      <form action={save}>
        <CardContent className="space-y-6">
          {error && <Alert tone="danger">{error}</Alert>}
          {saved && <Alert tone="success">Saved. New emails use these settings.</Alert>}
          {testSent && <Alert tone="success">{testSent}</Alert>}

          <div>
            <h3 className="mb-3 text-sm font-semibold">Identity</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company name" required
            help="Your business name as it appears at the top of every email sent to a customer.">
                <Input name="companyName" defaultValue={values.companyName} required />
              </Field>
              <Field label="Website"
            help="Your site. Shown in the email footer.">
                <Input name="websiteUrl" defaultValue={values.websiteUrl ?? ""} placeholder="https://www.babultech.com" />
              </Field>
              <Field label="Support email"
            help="The address customers should reply to for help. Appears in the footer of every email.">
                <Input name="supportEmail" type="email" defaultValue={values.supportEmail ?? ""} />
              </Field>
              <Field label="Support phone"
            help="The number shown in the email footer.">
                <Input name="supportPhone" defaultValue={values.supportPhone ?? ""} />
              </Field>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="mb-2 text-sm font-medium">Logo</p>

                {values.logoUrl && (
                  <div className="mb-3 flex items-center gap-3 rounded-md border bg-white p-3">
                    {/* Plain img, not next/image: this is the same file the email
                        references, so seeing it unoptimised is the point. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={values.logoUrl} alt="Current logo" className="h-12 w-auto" />
                    <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                      {values.logoUrl}
                    </p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadNow(file);
                    }}
                    className="cursor-pointer text-xs file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs file:font-medium"
                  />
                  {uploading && <span className="text-xs text-muted-foreground">Uploading…</span>}
                </div>

                <p className="mt-2 text-xs text-muted-foreground">
                  PNG or JPEG, under 2 MB. Uploading stores it publicly so email clients can fetch
                  it without a login - a private or protected URL shows as a broken image.
                </p>
              </div>

              <Field label="Or paste a URL"
            help="Link to a logo already hosted somewhere, instead of uploading one. It must be a PNG or JPEG - email clients block SVG.">
                <Input name="logoUrl" defaultValue={values.logoUrl ?? ""} placeholder="https://…/logo.png" />
              </Field>

              <Alert tone="info">
                <p>
                  <strong>SVG will not work.</strong> Gmail, Outlook and Apple Mail all block it,
                  export as PNG instead. Leave the logo empty and the company name is used as a
                  wordmark, which is what many recipients see anyway since images are often blocked
                  by default.
                </p>
              </Alert>
            </div>

            <div className="mt-4">
              <Field label="Address line"
            help="Your business address, shown in the footer.">
                <Input name="addressLine" defaultValue={values.addressLine ?? ""} placeholder="Office 4, Arfa Tower, Lahore" />
              </Field>
            </div>
          </div>

          <div>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Palette className="h-4 w-4 text-muted-foreground" /> Colours
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              The layout stays light even when your brand is dark. A dark email is legible on a
              phone and mangled by Outlook, and it has to arrive readable before it looks striking.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {swatch("brandColor", "Brand", "The accent bar and buttons.")}
              {swatch("brandColorDark", "Headings", "Company name and totals.")}
              {swatch("textColor", "Body text")}
              {swatch("mutedColor", "Secondary text")}
              {swatch("backgroundColor", "Page background", "Behind the white card.")}
            </div>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold">Wording</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Anyone sending can edit the message before it goes; this is what the compose box opens
              with.
            </p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {PLACEHOLDERS.map((p) => (
                <Badge key={p.token} tone="neutral" className="font-mono text-[11px]">
                  {p.token}
                </Badge>
              ))}
            </div>

            <div className="space-y-4">
              <Field label="Quotation subject"
            help="The default subject line for quotation emails. {{documentNumber}} and {{companyName}} are filled in automatically.">
                <Input name="quotationSubject" defaultValue={values.quotationSubject} required />
              </Field>
              <Field label="Quotation message"
            help="The default body of a quotation email. Whoever sends it can still edit before sending.">
                <Textarea name="quotationBody" rows={5} defaultValue={values.quotationBody} required />
              </Field>
              <Field label="Invoice subject"
            help="The default subject line for invoice emails, with the same placeholders available.">
                <Input name="invoiceSubject" defaultValue={values.invoiceSubject} required />
              </Field>
              <Field label="Invoice message"
            help="The default body of an invoice email.">
                <Textarea name="invoiceBody" rows={5} defaultValue={values.invoiceBody} required />
              </Field>
              <Field label="Footer"
            help="The small print at the bottom of every outgoing email - confidentiality wording, and anything else you are required to include.">
                <Textarea name="emailFooter" rows={2} defaultValue={values.emailFooter} />
              </Field>
            </div>
          </div>

          {preview && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Preview</h3>
              <iframe
                // Sandboxed: the preview is rendered HTML and has no reason to
                // run scripts or navigate the page it sits in.
                sandbox=""
                srcDoc={preview}
                title="Email preview"
                className="h-[520px] w-full rounded-lg border bg-white"
              />
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-wrap justify-between gap-2 border-t bg-muted/30 p-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => showPreview("quotation")} disabled={pending}>
              <Eye className="h-4 w-4" /> Preview quotation
            </Button>
            <Button type="button" variant="outline" onClick={() => showPreview("invoice")} disabled={pending}>
              <Eye className="h-4 w-4" /> Preview invoice
            </Button>
            <Button type="button" variant="ghost" onClick={() => sendTest("quotation")} disabled={pending}>
              <Send className="h-4 w-4" /> Send test to me
            </Button>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
