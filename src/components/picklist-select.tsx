"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button, Input, Select } from "@/components/ui";
import { addPicklistValue } from "@/server/picklists";
import { usePicklist } from "@/components/picklist";
import type { PicklistKey } from "@/lib/picklists";

/**
 * A dropdown that can create its own options, for the open lists.
 *
 * The campaign type picker proved the pattern: the person filling in the form
 * is the one who knows the value that is missing, and sending them to Settings
 * mid-form is how "Other" ends up meaning six different things. Adding happens
 * in place and the new value is selected straight away, so the form carries on
 * from where it was.
 *
 * Workflow lists are not offered here - their values carry rules the code has
 * to know - so those keep a plain <Select> with PicklistOptions.
 *
 * The inline panel is a sibling of the select rather than a dialog, matching
 * SelectWithAdd: there is no dialog primitive to reuse, and a hand-rolled one
 * would need focus trapping to be usable by keyboard.
 */
export function PicklistSelect({
  list,
  name,
  defaultValue = "",
  required,
  fallback,
  emptyLabel = "Not set",
  addLabel = "Add an option",
  onValueChange,
  disabled,
  className,
}: {
  list: PicklistKey;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  /** The form's built-in values, used only if the list has not loaded. */
  fallback?: readonly string[];
  /** Text of the blank choice. Omitted entirely when the field is required. */
  emptyLabel?: string | null;
  addLabel?: string;
  /** For a field that changes the rest of the form, such as activity type. */
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const options = usePicklist(list, { fallback, current: defaultValue });
  // Values added here are shown immediately; the refresh reloads the shared
  // list so every other form on the page sees them too.
  const [added, setAdded] = useState<{ value: string; label: string }[]>([]);
  const [value, setValue] = useState(defaultValue ?? "");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const all = [...options, ...added.filter((a) => !options.some((o) => o.value === a.value))];

  function submit() {
    const label = draft.trim();
    if (!label) {
      setError("Give it a name.");
      return;
    }
    setError(null);
    start(async () => {
      const result = await addPicklistValue(list, label);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setAdded((prev) => [...prev, result.value]);
      setValue(result.value.value);
      onValueChange?.(result.value.value);
      setDraft("");
      setAdding(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Select
          name={name}
          required={required}
          disabled={disabled}
          value={value}
          onChange={(e) => { setValue(e.target.value); onValueChange?.(e.target.value); }}
          className={className ?? "flex-1"}
        >
          {emptyLabel !== null && <option value="">{emptyLabel}</option>}
          {all.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>

        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => { setAdding((open) => !open); setError(null); }}
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
                value={draft}
                maxLength={100}
                onChange={(e) => setDraft(e.target.value)}
                className="mt-1"
                // Enter would otherwise submit the form underneath, saving a
                // half-filled record instead of adding the option.
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); submit(); }
                  if (e.key === "Escape") setAdding(false);
                }}
              />
            </label>
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
