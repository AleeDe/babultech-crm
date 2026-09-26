"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from "@/components/ui";
import { saveBusinessHours, type BusinessHoursRow } from "@/server/company";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type Day = (typeof DAYS)[number];

// The zones this business actually deals with, rather than all four hundred.
const TIME_ZONES = [
  "Asia/Karachi", "Asia/Dubai", "Asia/Riyadh", "Europe/London",
  "America/Toronto", "America/New_York", "Australia/Sydney", "UTC",
];

/**
 * The working week, seven rows.
 *
 * Every day is either open with a real range or explicitly closed - never half
 * filled - because the SLA engine counts only open hours, and a day with a start
 * but no end is a day nobody can say whether the clock runs.
 */
export function BusinessHoursForm({ current }: { current: BusinessHoursRow | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const initial = Object.fromEntries(
    DAYS.map((day) => {
      const d = current?.weeklySchedule?.[day];
      return [day, { open: Boolean(d), start: d?.start ?? "09:00", end: d?.end ?? "18:00" }];
    }),
  ) as Record<Day, { open: boolean; start: string; end: string }>;

  const [days, setDays] = useState(initial);

  const update = (day: Day, patch: Partial<{ open: boolean; start: string; end: string }>) =>
    setDays((d) => ({ ...d, [day]: { ...d[day], ...patch } }));

  function submit(fd: FormData) {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await saveBusinessHours({
        id: current?.id ?? null,
        name: String(fd.get("name") ?? ""),
        timezone: String(fd.get("timezone") ?? ""),
        isDefault: true,
        days,
      });
      if (result.ok) {
        setSaved(true);
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <form action={submit} className="space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}
      {saved && <Alert tone="success">Saved. SLA clocks use these hours from now on.</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Schedule</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <Input name="name" required maxLength={100} defaultValue={current?.name ?? "Office hours"} />
          </Field>
          <Field label="Time zone" required help="The hours below are in this zone.">
            <Select name="timezone" defaultValue={current?.timezone ?? "Asia/Karachi"}>
              {TIME_ZONES.map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The week</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {DAYS.map((day) => {
            const d = days[day];
            return (
              <div key={day} className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
                <label className="flex w-32 items-center gap-2 text-sm font-medium capitalize">
                  <input type="checkbox" checked={d.open} onChange={(e) => update(day, { open: e.target.checked })} />
                  {day}
                </label>
                {d.open ? (
                  <div className="flex items-center gap-2 text-sm">
                    <Input
                      type="time"
                      value={d.start}
                      onChange={(e) => update(day, { start: e.target.value })}
                      className="w-32"
                      aria-label={`${day} opens`}
                    />
                    <span className="text-muted-foreground">to</span>
                    <Input
                      type="time"
                      value={d.end}
                      onChange={(e) => update(day, { end: e.target.value })}
                      className="w-32"
                      aria-label={`${day} closes`}
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Closed</span>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save business hours"}
      </Button>
    </form>
  );
}
