"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

/**
 * Tabs, on the Radix primitive that was already a dependency.
 *
 * @radix-ui/react-tabs has been in package.json since the project started and
 * was never imported — so every detail screen stacked its panels vertically and
 * the reader scrolled past everything to reach anything. The project page was
 * the worst of them: a board, a task list, a plan, a team, a RAID log, change
 * requests, notes and documents, all at once, in one column.
 *
 * Radix rather than hand-rolled because tabs have real keyboard semantics —
 * arrow keys move between them, Home/End jump to the ends, and the panel is
 * associated with its trigger for screen readers. That is a lot of correctness
 * to reimplement, and getting it subtly wrong is worse than not having tabs.
 *
 * The tab state lives in the URL (see `TabbedSections`), so a reload or a
 * shared link lands on the same panel rather than snapping back to the first.
 */
export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      // Scrolls rather than wraps: a wrapped second row of tabs reads as a
      // different kind of navigation, and on a phone there is not room for one.
      "flex items-center gap-1 overflow-x-auto border-b",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative whitespace-nowrap px-3 py-2 text-sm text-muted-foreground transition-colors",
      "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      // The underline sits on the active trigger rather than a separate
      // indicator element, so it cannot drift out of step with the selection.
      "data-[state=active]:font-medium data-[state=active]:text-foreground",
      "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
      "data-[state=active]:after:bg-primary",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-6 focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";

/**
 * A count beside a tab label, so the reader knows what is behind it before
 * opening it — the main cost of hiding content is not knowing it is there.
 *
 * Zero renders nothing rather than "0": an empty tab is worth opening to add
 * the first item, and a grey zero on every tab is noise.
 */
export function TabCount({ value }: { value: number }) {
  if (!value) return null;
  return (
    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
      {value}
    </span>
  );
}
