"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Bookmark, Check, ChevronDown, Star, Trash2, Users } from "lucide-react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { FormDialog } from "@/components/form-dialog";
import { cn } from "@/lib/utils";
import { saveView, setDefaultView, deleteView, type SavedView, type ListName } from "@/server/saved-views";

/**
 * Saved views of a list: its filters, kept under a name.
 *
 * The current view is whichever saved one matches the address exactly; the
 * menu ticks it. "Save current view" keeps whatever the filters now say.
 */
export function SavedViewsMenu({ entity, views, canShare }: { entity: ListName; views: SavedView[]; canShare: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const current = (() => {
    const params = new URLSearchParams(search.toString());
    for (const key of ["page", "all"]) params.delete(key);
    return params.toString();
  })();
  const active = views.find((v) => v.query === current);

  // A full load rather than router.push: pushed from inside the closing menu,
  // the client navigation was dropped and the list stayed where it was.
  const go = (href: string) => window.location.assign(href);

  function save() {
    start(async () => {
      setError(null);
      const result = await saveView({ entity, name, query: current, isDefault, shared });
      if (!result.ok) return setError(result.error);
      setOpen(false);
      setName("");
      router.refresh();
    });
  }

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const result = await fn();
      if (!result.ok && "error" in result) window.alert(result.error);
      router.refresh();
    });

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button variant="outline">
            <Bookmark className="h-4 w-4" />
            {active ? active.name : "Views"}
            <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={6} className="z-50 w-72 rounded-lg border bg-card p-1 shadow-xl">
            {/* Navigated on select rather than through a link: the menu closes
                on pointer-up, which would unmount a link before its click. */}
            <Menu.Item
              onSelect={() => go(`/${entity}?all=1`)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none hover:bg-accent focus:bg-accent"
            >
              <span className="w-4">{!current && <Check className="h-4 w-4" />}</span>
              All records
            </Menu.Item>
            {views.length > 0 && <Menu.Separator className="my-1 h-px bg-border" />}
            {views.map((v) => (
              <div key={v.id} className="group flex items-center rounded-md hover:bg-accent">
                <Menu.Item
                  onSelect={() => go(`/${entity}?${v.query}`)}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-2.5 py-2 text-sm outline-none focus:bg-accent"
                >
                  <span className="w-4 shrink-0">{active?.id === v.id && <Check className="h-4 w-4" />}</span>
                  <span className="truncate">{v.name}</span>
                  {v.shared && <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Shared with everyone" />}
                  {v.isDefault && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-amber-500" aria-label="Your default" />}
                </Menu.Item>
                <button
                  type="button"
                  title={v.isDefault ? "Stop opening this by default" : "Open this view by default"}
                  aria-label={v.isDefault ? `Stop opening ${v.name} by default` : `Open ${v.name} by default`}
                  disabled={pending}
                  onClick={() => run(() => setDefaultView(entity, v.isDefault ? null : v.id))}
                  className="px-1.5 text-muted-foreground hover:text-foreground"
                >
                  <Star className={cn("h-3.5 w-3.5", v.isDefault && "fill-current text-amber-500")} />
                </button>
                {v.mine && (
                  <button
                    type="button"
                    title="Delete this view"
                    aria-label={`Delete ${v.name}`}
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Delete the view "${v.name}"?`)) run(() => deleteView(v.id));
                    }}
                    className="px-1.5 pr-2 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.Item
              disabled={!current}
              onSelect={() => setOpen(true)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none hover:bg-accent focus:bg-accent data-[disabled]:cursor-default data-[disabled]:opacity-50"
            >
              <span className="w-4" />
              {current ? "Save current view…" : "Filter the list to save a view"}
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <FormDialog open={open} onOpenChange={setOpen} title="Save this view">
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Keeps the list&apos;s current filters under a name, in the Views menu.</p>
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="My open leads from the webinar" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4" />
            Open this list with this view
          </label>
          {canShare && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="h-4 w-4" />
              Share with everyone
            </label>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="button" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save view"}</Button>
          </div>
        </div>
      </FormDialog>
    </>
  );
}
