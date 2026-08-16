"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button, Select, Alert } from "@/components/ui";

export interface BulkAction {
  /** Shown on the button. */
  label: string;
  /** Options for the accompanying dropdown; omit for a bare button. */
  options?: { value: string; label: string }[];
  placeholder?: string;
  run: (ids: string[], value: string) => Promise<{
    ok: boolean;
    error?: string;
    data?: { requested: number; updated: number; note?: string };
  }>;
}

/**
 * The bar that appears once rows are selected.
 *
 * It reports what actually changed rather than what was asked for. RLS can
 * silently drop rows the caller may not touch, and "20 updated" when eleven
 * moved is a lie nobody in the room can catch.
 */
export function BulkBar({
  selected,
  onClear,
  actions,
}: {
  selected: string[];
  onClear: () => void;
  actions: BulkAction[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  if (selected.length === 0) return null;

  function run(action: BulkAction) {
    const value = values[action.label] ?? "";
    if (action.options && !value) {
      setError(`Choose a value for "${action.label}" first.`);
      return;
    }

    setError(null);
    setResult(null);

    start(async () => {
      const outcome = await action.run(selected, value);

      if (!outcome.ok) {
        setError(outcome.error ?? "That did not work.");
        return;
      }

      const data = outcome.data;
      setResult(
        data
          ? `${data.updated} of ${data.requested} updated.${data.note ? ` ${data.note}` : ""}`
          : "Done.",
      );
      onClear();
      router.refresh();
    });
  }

  return (
    <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
      {error && (
        <div className="mb-3">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {result && (
        <div className="mb-3">
          <Alert tone="success">{result}</Alert>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">
          {selected.length} selected
        </span>

        <span className="h-4 w-px bg-border" aria-hidden />

        {actions.map((action) => (
          <span key={action.label} className="flex items-center gap-1.5">
            {action.options && (
              <Select
                value={values[action.label] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [action.label]: e.target.value }))
                }
                aria-label={action.placeholder ?? action.label}
                className="h-8 w-44 text-xs"
              >
                <option value="">{action.placeholder ?? "Choose…"}</option>
                {action.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
            <Button size="sm" variant="secondary" onClick={() => run(action)} disabled={pending}>
              {action.label}
            </Button>
          </span>
        ))}

        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onClear();
            setError(null);
            setResult(null);
          }}
          className="ml-auto"
        >
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      </div>
    </div>
  );
}

/** The header checkbox: checked when all are selected, dashed when some are. */
export function SelectAllBox({
  total,
  selected,
  onToggle,
}: {
  total: number;
  selected: number;
  onToggle: (all: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      checked={total > 0 && selected === total}
      ref={(el) => {
        if (el) el.indeterminate = selected > 0 && selected < total;
      }}
      onChange={(e) => onToggle(e.target.checked)}
      aria-label={selected === total ? "Deselect all" : "Select all"}
      className="cursor-pointer"
    />
  );
}

export function SelectBox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
      className="cursor-pointer"
    />
  );
}

/** Wraps a list table so rows can be selected. Kept here so every list behaves the same. */
export function useSelection<T extends { id: string }>(rows: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleAll = (on: boolean) =>
    setSelected(on ? new Set(rows.map((r) => r.id)) : new Set());

  return {
    selected,
    ids: [...selected],
    isSelected: (id: string) => selected.has(id),
    toggle,
    toggleAll,
    clear: () => setSelected(new Set()),
  };
}

export type { ReactNode };
