"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui";
import { saveCompanySetting, type CompanySetting } from "@/server/company";

/**
 * The organisation's own settings.
 *
 * Locale, time zone and language are shown but fixed for now: the whole app is
 * written for en-PK and Asia/Karachi, and offering a choice the rest of the
 * system does not honour would be a setting that quietly does nothing.
 */
export function CompanySettingForm({
  setting,
  accountName,
  currencies,
}: {
  setting: CompanySetting;
  accountName: string | null;
  currencies: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const DEFAULTS = ["PKR", "USD", "CAD", "AUD", "AED"].filter((c) => currencies.includes(c));

  function submit(fd: FormData) {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await saveCompanySetting({
        companyName: String(fd.get("companyName") ?? ""),
        locale: setting.locale,
        timezone: setting.timezone,
        language: setting.language,
        defaultCurrency: String(fd.get("defaultCurrency") ?? "PKR") as "PKR",
        corporateCurrency: String(fd.get("corporateCurrency") ?? "USD"),
      });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={submit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {error && <div className="sm:col-span-2 lg:col-span-3"><Alert tone="danger">{error}</Alert></div>}
          {saved && <div className="sm:col-span-2 lg:col-span-3"><Alert tone="success">Saved. Every amount now shows in the new currencies.</Alert></div>}

          <Field label="Company name" required>
            <Input name="companyName" required maxLength={200} defaultValue={setting.companyName} />
          </Field>
          <Field
            label="Default currency"
            required
            help="The currency every amount is calculated in."
          >
            <Select name="defaultCurrency" defaultValue={setting.defaultCurrency}>
              {DEFAULTS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Corporate currency"
            required
            help="Shown beside amounts, converted at today's rate, for reference only. Nothing is calculated in it."
          >
            <Select name="corporateCurrency" defaultValue={setting.corporateCurrency}>
              {currencies.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Company locale" help="How numbers and dates are written.">
            <Input value="English (Pakistan) — Karachi" readOnly disabled />
          </Field>
          <Field label="Time zone">
            <Input value={setting.timezone} readOnly disabled />
          </Field>
          <Field label="Default language">
            <Input value="English" readOnly disabled />
          </Field>
          <Field
            label="Our account"
            help="Us, as a record. Products and services we own default to it."
          >
            <Input value={accountName ?? "Not linked"} readOnly disabled />
          </Field>

          <div className="sm:col-span-2 lg:col-span-3">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save settings"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
