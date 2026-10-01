"use client";

import { useState, useTransition } from "react";
import { Alert, Button, Input, Table, THead, TBody, TR, TH, TD } from "@/components/ui";
import { saveNumbering, type NumberingRow } from "@/server/numbering-settings";
import { humanize } from "@/lib/utils";

/** What the next number will look like. Mirrors next_sequence_number(). */
function preview(row: NumberingRow): string {
  const n = String(row.nextValue).padStart(row.paddingLength, "0");
  return row.includeYear ? `${row.prefix}-${new Date().getFullYear()}-${n}` : `${row.prefix}-${n}`;
}

export function NumberingEditor({ rows: initial }: { rows: NumberingRow[] }) {
  const [rows, setRows] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const update = (type: string, patch: Partial<NumberingRow>) =>
    setRows((list) => list.map((r) => (r.entityType === type ? { ...r, ...patch } : r)));

  const save = (row: NumberingRow) =>
    start(async () => {
      setMessage(null);
      const result = await saveNumbering(row);
      if (!result.ok) return setMessage({ tone: "danger", text: `${humanize(row.entityType)}: ${result.error}` });
      update(row.entityType, result.data);
      setSaved((list) => list.map((r) => (r.entityType === row.entityType ? result.data : r)));
      setMessage({ tone: "success", text: `${humanize(row.entityType)} saved. The next one will be ${preview(result.data)}.` });
    });

  return (
    <div className="space-y-4">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <Table>
        <THead>
          <TR>
            <TH>Record</TH>
            <TH>Prefix</TH>
            <TH>Digits</TH>
            <TH>Year</TH>
            <TH>Next number</TH>
            <TH>Next will be</TH>
            <TH />
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => {
            const before = saved.find((s) => s.entityType === row.entityType)!;
            const changed = JSON.stringify(before) !== JSON.stringify(row);
            const label = humanize(row.entityType);
            return (
              <TR key={row.entityType} data-sequence={row.entityType}>
                <TD className="text-sm font-medium">{label}</TD>
                <TD><Input className="w-24" value={row.prefix} maxLength={10} aria-label={`${label} prefix`} onChange={(e) => update(row.entityType, { prefix: e.target.value.toUpperCase() })} /></TD>
                <TD><Input className="w-20" type="number" min={3} max={10} value={row.paddingLength} aria-label={`${label} digits`} onChange={(e) => update(row.entityType, { paddingLength: Number(e.target.value) })} /></TD>
                <TD><input type="checkbox" checked={row.includeYear} aria-label={`${label} includes the year`} onChange={(e) => update(row.entityType, { includeYear: e.target.checked })} /></TD>
                <TD><Input className="w-28" type="number" min={before.nextValue} value={row.nextValue} aria-label={`${label} next number`} onChange={(e) => update(row.entityType, { nextValue: Number(e.target.value) })} /></TD>
                <TD className="font-mono text-xs">{preview(row)}</TD>
                <TD className="text-right">
                  <Button size="sm" variant={changed ? "default" : "ghost"} disabled={pending || !changed} onClick={() => save(row)}>Save</Button>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
