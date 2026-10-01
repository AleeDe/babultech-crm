"use client";

import { useState, useTransition } from "react";
import { Download, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui";
import { scheduleReport, deleteSchedule } from "@/server/reports";
import type { ReportColumn } from "@/lib/reports";

/** Download as CSV, and ask for the report weekly or monthly. */
export function ReportTools({
  reportKey,
  title,
  query,
  columns,
  rows,
  totals,
  scheduled,
}: {
  reportKey: string;
  title: string;
  query: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
  scheduled: string[];
}) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState<string[]>(scheduled);

  function download() {
    const cell = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [columns.map((c) => cell(c.label)).join(",")]
      .concat(rows.map((r) => columns.map((c) => cell(r[c.key])).join(",")))
      .concat(totals ? [columns.map((c) => cell(totals[c.key])).join(",")] : []);
    const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const schedule = (frequency: "WEEKLY" | "MONTHLY") =>
    start(async () => {
      const result = await scheduleReport({ reportKey, query, frequency });
      if (!result.ok) return window.alert(result.error);
      setDone((d) => [...d, frequency]);
    });

  return (
    <>
      <Button variant="outline" onClick={download} disabled={rows.length === 0}>
        <Download className="h-4 w-4" /> CSV
      </Button>
      {(["WEEKLY", "MONTHLY"] as const).map((f) => (
        <Button key={f} variant="outline" disabled={pending || done.includes(f)} onClick={() => schedule(f)}>
          <CalendarClock className="h-4 w-4" />
          {done.includes(f) ? `Sent to you ${f.toLowerCase()}` : `Send me this ${f.toLowerCase()}`}
        </Button>
      ))}
    </>
  );
}

export function RemoveSchedule({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  if (gone) return <span className="text-xs text-muted-foreground">Removed</span>;
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await deleteSchedule(id);
          if (!result.ok) return window.alert(result.error);
          setGone(true);
        })
      }
    >
      Stop
    </Button>
  );
}
