"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Select, Input, Button } from "@/components/ui";

export interface Option {
  id: string;
  name: string;
}

/**
 * A picker that can create its own options.
 *
 * The campaign form was the case that forced this: a fresh database has no
 * campaign types, the Type field is required, and the notice on the form sent
 * people to a Settings screen that does not manage them. The form was therefore
 * impossible to complete — and even once a Settings screen exists, leaving a
 * half-filled form to go and create one lookup value is a bad trade.
 *
 * Adding happens in place. The new option is selected the moment it is created,
 * so the flow returns to exactly where it left off with the field filled in.
 *
 * The panel is a sibling of the select rather than a modal: there is no dialog
 * primitive in this codebase, and a hand-rolled one would need focus trapping
 * and escape handling to be usable by keyboard. An inline panel is correct
 * without any of that.
 */
export function SelectWithAdd({
  name,
  options: initial,
  defaultValue = "",
  required,
  placeholder = "Choose one…",
  addLabel = "Add new",
  /** Server action that creates the option and returns it. */
  onCreate,
  /** Optional second field, e.g. a channel for a campaign type. */
  extraField,
}: {
  name: string;
  options: Option[];
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  addLabel?: string;
  onCreate: (input: {
    name: string;
    channel?: string | null;
  }) => Promise<
    | { ok: true; data?: Option }
    | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> }
  >;
  extraField?: { name: string; label: string; placeholder?: string };
}) {
  const [options, setOptions] = useState<Option[]>(initial);
  const [value, setValue] = useState(defaultValue);
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftExtra, setDraftExtra] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError("Give it a name.");
      return;
    }
    setError(null);
    start(async () => {
      const result = await onCreate({ name: trimmed, channel: draftExtra.trim() || null });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data) {
        // Inserted in name order so the list stays sorted the way the server
        // returned it, rather than growing a pile of recent additions at the end.
        setOptions((prev) =>
          [...prev, result.data!].sort((a, b) => a.name.localeCompare(b.name)),
        );
        setValue(result.data.id);
      }
      setDraftName("");
      setDraftExtra("");
      setAdding(false);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select
          name={name}
          required={required}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="flex-1"
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setAdding((open) => !open);
            setError(null);
          }}
          aria-expanded={adding}
          title={addLabel}
          className="shrink-0 px-2"
        >
          {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          <span className="sr-only">{addLabel}</span>
        </Button>
      </div>

      {adding && (
        <div className="rounded-md border border-dashed bg-muted/30 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-[10rem] flex-1 text-xs font-medium text-muted-foreground">
              Name
              <Input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Webinar"
                className="mt-1"
                // Enter would otherwise submit the campaign form underneath,
                // creating a half-filled campaign instead of a lookup value.
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                  if (e.key === "Escape") setAdding(false);
                }}
              />
            </label>

            {extraField && (
              <label className="min-w-[10rem] flex-1 text-xs font-medium text-muted-foreground">
                {extraField.label}
                <Input
                  value={draftExtra}
                  onChange={(e) => setDraftExtra(e.target.value)}
                  placeholder={extraField.placeholder}
                  className="mt-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                    if (e.key === "Escape") setAdding(false);
                  }}
                />
              </label>
            )}

            <Button type="button" onClick={submit} disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
          </div>

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}
