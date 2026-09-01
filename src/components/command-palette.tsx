"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Search, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PaletteItem {
  href: string;
  label: string;
  /** The nav group it came from, shown as context and matched against. */
  group: string;
}

/**
 * Jump to any screen by typing part of its name.
 *
 * Twenty-five destinations in eight groups is more than a sidebar can show at
 * once — at full height the nav is around 1,200px against roughly 840px of
 * viewport, which is what put a scrollbar in it. Collapsing the groups fixes the
 * height but adds a click to reach anything that is put away, so the two changes
 * belong together: groups for browsing, this for going somewhere directly.
 *
 * That is also how the tools this is modelled on work. In Linear and ClickUp the
 * sidebar is for orientation and Cmd+K is how people who use it daily actually
 * move. Hick's Law is the reason it wins: a list of twenty-five choices costs
 * time to scan, while typing three letters narrows it to one or two.
 *
 * Built on @radix-ui/react-dialog, which has been a dependency since the project
 * started and was never imported. Radix carries the parts that are easy to get
 * subtly wrong — focus trapping, restoring focus to whatever was focused before,
 * inert background content, Escape handling — none of which is worth
 * reimplementing by hand.
 *
 * Only pages the person may open are passed in, so the palette can never offer a
 * screen that would refuse them on arrival.
 */
export function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Cmd on a Mac, Ctrl elsewhere — the same chord people already have in
      // their fingers from every other tool that does this.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;

    // Ranked, not just filtered: something starting with what was typed is far
    // more likely to be what was meant than something merely containing it, and
    // an unranked list makes the first Enter press feel arbitrary.
    return items
      .map((item) => {
        const label = item.label.toLowerCase();
        const group = item.group.toLowerCase();
        if (label.startsWith(q)) return { item, rank: 0 };
        if (label.includes(q)) return { item, rank: 1 };
        if (group.includes(q)) return { item, rank: 2 };
        return null;
      })
      .filter((r): r is { item: PaletteItem; rank: number } => r !== null)
      .sort((a, b) => a.rank - b.rank)
      .map((r) => r.item);
  }, [items, query]);

  // Typing changes what is on screen, so the highlight has to return to the top
  // or Enter would open whatever happened to sit at the old index.
  useEffect(() => setActive(0), [query]);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      go(results[active].href);
    }
  }

  // Keeps the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1 text-left">Search…</span>
        {/* Advertises the shortcut rather than hiding it: a keyboard feature
            nobody discovers may as well not exist. */}
        <kbd className="hidden rounded border bg-muted px-1 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </button>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content
            onKeyDown={onKeyDown}
            className={cn(
              "fixed left-1/2 top-[15%] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2",
              "overflow-hidden rounded-xl border bg-card shadow-2xl",
            )}
          >
            <Dialog.Title className="sr-only">Go to a screen</Dialog.Title>
            <Dialog.Description className="sr-only">
              Type to filter, then press Enter to open.
            </Dialog.Description>

            <div className="flex items-center gap-2 border-b px-3">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Go to…"
                className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                esc
              </kbd>
            </div>

            <ul ref={listRef} className="max-h-80 overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nothing matches “{query}”.
                </li>
              ) : (
                results.map((item, i) => (
                  <li key={item.href} data-index={i}>
                    <button
                      type="button"
                      onClick={() => go(item.href)}
                      // Pointer and keyboard drive the same highlight, so the
                      // two cannot disagree about which row Enter would open.
                      onMouseMove={() => setActive(i)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                        i === active ? "bg-accent text-foreground" : "text-muted-foreground",
                      )}
                    >
                      <span className="flex-1 truncate text-foreground">{item.label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{item.group}</span>
                      {i === active && <CornerDownLeft className="h-3 w-3 shrink-0" />}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
