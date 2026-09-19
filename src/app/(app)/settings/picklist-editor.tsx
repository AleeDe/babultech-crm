"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Select, Badge, Alert,
} from "@/components/ui";
import {
  addPicklistValue, updatePicklistValue, movePicklistValue, deletePicklistValue,
} from "@/server/picklists";
import type { Picklist } from "@/lib/picklists";

type Result = { ok: true } | { ok: false; error: string };

/**
 * Settings panel for every configurable dropdown.
 *
 * Open lists can be added to and pruned. Locked lists are workflow values the
 * code relies on, so they can only be renamed, reordered and hidden. Removing a
 * value never touches records that already use it.
 */
export function PicklistEditor({ lists }: { lists: Picklist[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState(lists[0]?.key ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const list = lists.find((l) => l.key === selected);
  const groups = useMemo(() => {
    const byGroup = new Map<string, Picklist[]>();
    for (const l of lists) byGroup.set(l.groupName, [...(byGroup.get(l.groupName) ?? []), l]);
    return [...byGroup.entries()];
  }, [lists]);

  function run(fn: () => Promise<Result>, after?: () => void) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (result.ok) {
        after?.();
        router.refresh();
      } else setError(result.error);
    });
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Dropdown lists</CardTitle>
        <CardDescription>
          The values offered in every dropdown. Records keep the value they already have when one is
          hidden or removed. Locked lists drive workflow rules, so their values can be renamed,
          reordered and hidden, but not added or deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {lists.length === 0 ? (
          <Alert tone="warning">
            No dropdown lists found. Apply the latest database migration (picklists_price_books) first.
          </Alert>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Select
                aria-label="Dropdown list"
                value={selected}
                onChange={(e) => { setSelected(e.target.value); setEditing(null); setError(null); }}
                className="w-72"
              >
                {groups.map(([group, items]) => (
                  <optgroup key={group} label={group}>
                    {items.map((l) => (
                      <option key={l.key} value={l.key}>{l.label}{l.locked ? " (locked)" : ""}</option>
                    ))}
                  </optgroup>
                ))}
              </Select>
              {list?.description && <p className="text-sm text-muted-foreground">{list.description}</p>}
            </div>

            {error && <Alert tone="danger">{error}</Alert>}

            {list && (
              <>
                {list.locked ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Lock className="h-3.5 w-3.5" /> Workflow list: rename, reorder or hide values only.
                  </p>
                ) : (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => addPicklistValue(list.key, newLabel), () => setNewLabel(""));
                    }}
                  >
                    <Input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder={`New ${list.label.toLowerCase()}`}
                      maxLength={100}
                      className="max-w-sm"
                    />
                    <Button type="submit" variant="secondary" disabled={pending || !newLabel.trim()}>
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  </form>
                )}

                <ul className="divide-y rounded-md border">
                  {list.values.length === 0 && (
                    <li className="p-4 text-center text-sm text-muted-foreground">No values yet.</li>
                  )}
                  {list.values.map((v, i) => (
                    <li key={v.id} className={`flex items-center gap-2 px-3 py-2 ${v.active ? "" : "opacity-60"}`}>
                      {editing === v.id ? (
                        <form
                          className="flex flex-1 items-center gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            run(() => updatePicklistValue(v.id, { label: editLabel }), () => setEditing(null));
                          }}
                        >
                          <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} maxLength={100} className="flex-1" autoFocus />
                          <Button type="submit" size="sm" disabled={pending}><Check className="h-4 w-4" /></Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
                        </form>
                      ) : (
                        <>
                          <span className="flex-1 text-sm">
                            {v.label}
                            {v.label !== v.value && (
                              <span className="ml-2 font-mono text-xs text-muted-foreground">{v.value}</span>
                            )}
                          </span>
                          {!v.active && <Badge tone="neutral">Hidden</Badge>}
                          <IconButton label="Move up" disabled={pending || i === 0} onClick={() => run(() => movePicklistValue(v.id, "up"))}>
                            <ArrowUp className="h-4 w-4" />
                          </IconButton>
                          <IconButton label="Move down" disabled={pending || i === list.values.length - 1} onClick={() => run(() => movePicklistValue(v.id, "down"))}>
                            <ArrowDown className="h-4 w-4" />
                          </IconButton>
                          <IconButton label={`Rename ${v.label}`} disabled={pending} onClick={() => { setEditing(v.id); setEditLabel(v.label); }}>
                            <Pencil className="h-4 w-4" />
                          </IconButton>
                          <IconButton
                            label={v.active ? `Hide ${v.label}` : `Show ${v.label}`}
                            disabled={pending}
                            onClick={() => run(() => updatePicklistValue(v.id, { active: !v.active }))}
                          >
                            {v.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </IconButton>
                          {!list.locked && (
                            <IconButton
                              label={`Remove ${v.label}`}
                              danger
                              disabled={pending}
                              onClick={() => {
                                if (window.confirm(`Remove "${v.label}" from ${list.label}? Records already using it keep it.`)) {
                                  run(() => deletePicklistValue(v.id));
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconButton>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function IconButton({
  label, onClick, disabled, danger, children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-1 text-muted-foreground disabled:opacity-40 ${danger ? "hover:text-destructive" : "hover:text-foreground"}`}
    >
      {children}
    </button>
  );
}
