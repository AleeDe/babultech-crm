"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@/components/ui";
import { saveHolidays } from "@/server/company";

/** The days the office is closed, which SLA clocks skip. */
export function HolidaysEditor({ businessHoursId, holidays: initial }: { businessHoursId: string; holidays: { date: string; name: string }[] }) {
  const [holidays, setHolidays] = useState(initial);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = (next: { date: string; name: string }[]) =>
    start(async () => {
      setMessage(null);
      const result = await saveHolidays({ businessHoursId, holidays: next });
      if (!result.ok) return setMessage({ tone: "danger", text: result.error });
      setHolidays([...next].sort((a, b) => a.date.localeCompare(b.date)));
      setMessage({ tone: "success", text: "Saved. New deadlines skip these days." });
    });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Holidays</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Days the office is closed. Support clocks skip them, as they skip evenings and weekends. Deadlines already set are not moved.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {message && <Alert tone={message.tone}>{message.text}</Alert>}
        {holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">None listed.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {holidays.map((h) => (
              <li key={h.date} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>
                  <span className="font-medium tabular-nums">{h.date}</span> · {h.name}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${h.name}`}
                  disabled={pending}
                  onClick={() => save(holidays.filter((x) => x.date !== h.date))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted-foreground">
            Date
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-44" aria-label="Holiday date" />
          </label>
          <label className="min-w-[200px] flex-1 text-xs text-muted-foreground">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Independence Day" className="mt-1" aria-label="Holiday name" />
          </label>
          <Button
            type="button"
            disabled={pending || !date || !name.trim()}
            onClick={() => {
              save([...holidays.filter((h) => h.date !== date), { date, name: name.trim() }]);
              setDate("");
              setName("");
            }}
          >
            Add holiday
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
