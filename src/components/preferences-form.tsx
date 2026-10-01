"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Select } from "@/components/ui";
import { savePreferences, type Preferences } from "@/server/preferences";

/**
 * Your time zone, date format and start page. `zones` comes from the server, so
 * the list the server renders is the list the browser hydrates.
 */
export function PreferencesForm({ initial, startPages, zones }: { initial: Preferences; startPages: { href: string; label: string }[]; zones: string[] }) {
  const [timeZone, setTimeZone] = useState(initial.timeZone ?? "");
  const [dateFormat, setDateFormat] = useState(initial.dateFormat);
  const [startPage, setStartPage] = useState(initial.startPage ?? "");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const save = () =>
    start(async () => {
      setMessage(null);
      const result = await savePreferences({ timeZone: timeZone || null, dateFormat, startPage: startPage || null });
      if (!result.ok) return setMessage({ tone: "danger", text: result.error });
      setMessage({ tone: "success", text: "Saved. Dates now show in your time zone and format." });
      // Every date on the page was drawn with the old settings.
      window.setTimeout(() => window.location.reload(), 800);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">How dates read for you, and where you land after signing in.</p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        <label className="block space-y-1.5">
          <span className="font-medium">Time zone</span>
          <Select value={timeZone} onChange={(e) => setTimeZone(e.target.value)} aria-label="Time zone">
            <option value="">The company&apos;s{initial.companyTimeZone ? ` (${initial.companyTimeZone})` : ""}</option>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="font-medium">Date format</span>
          <Select value={dateFormat} onChange={(e) => setDateFormat(e.target.value as Preferences["dateFormat"])} aria-label="Date format">
            <option value="DMY">01 Oct 2026</option>
            <option value="MDY">Oct 01, 2026</option>
            <option value="YMD">2026-10-01</option>
          </Select>
        </label>
        <label className="block space-y-1.5">
          <span className="font-medium">Start page</span>
          <Select value={startPage} onChange={(e) => setStartPage(e.target.value)} aria-label="Start page">
            <option value="">{startPages[0]?.label ?? "Home"}</option>
            {startPages.slice(1).map((p) => <option key={p.href} value={p.href}>{p.label}</option>)}
          </Select>
        </label>
        <Button onClick={save} disabled={pending}>{pending ? "Saving…" : "Save preferences"}</Button>
      </CardContent>
    </Card>
  );
}
