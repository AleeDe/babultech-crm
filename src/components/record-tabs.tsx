"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent, TabCount } from "@/components/ui/tabs";

export interface RecordTab {
  value: string;
  label: string;
  /** Shown beside the label so the reader knows what is behind a closed tab. */
  count?: number;
  content: React.ReactNode;
}

/**
 * The tab strip for a record detail screen.
 *
 * Detail pages had grown to eight or nine stacked panels — the project page
 * rendered a board, a task list, a plan, a team, a RAID log, change requests,
 * notes and documents in one column, so finding the team meant scrolling past
 * two hundred task cards. Everything was equally prominent, which is the same
 * as nothing being prominent.
 *
 * What stays outside the tabs is deliberate: the title, the status badges and
 * the headline figures. Those answer "is this project in trouble?", which is
 * the question someone opens the page with, and burying any of it behind a tab
 * would trade one problem for another.
 *
 * The active tab is a URL parameter rather than component state, so a reload,
 * a shared link, or the back button all land where the reader expects.
 * `replace` rather than `push` keeps the browser's back button meaning "the
 * previous page" instead of stepping back through every tab that was opened.
 */
export function RecordTabs({
  tabs,
  param = "tab",
}: {
  tabs: RecordTab[];
  /** Query parameter name — override when two tab strips share one page. */
  param?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get(param);
  // An unknown value in the URL falls back to the first tab rather than
  // rendering an empty page: the parameter is user-editable, and a typo in a
  // shared link should not produce a blank screen.
  const fromUrl = tabs.some((t) => t.value === requested)
    ? (requested as string)
    : tabs[0]?.value;
  const [active, setActive] = useState(fromUrl);
  // Back/forward or a link to another tab of the same page.
  useEffect(() => setActive(fromUrl), [fromUrl]);

  function select(value: string) {
    // Switched here, at once: every tab's content is already on the page.
    // router.replace() did not take effect in the production build, so the
    // tabs did not switch at all.
    setActive(value);
    const next = new URLSearchParams(window.location.search);
    // The first tab is the default, so it is left out of the URL — a clean
    // address for the common case.
    if (value === tabs[0]?.value) next.delete(param);
    else next.set(param, value);

    const query = next.toString();
    window.history.replaceState(window.history.state, "", query ? `${pathname}?${query}` : pathname);
  }

  return (
    <Tabs value={active} onValueChange={select} className="mt-6">
      <TabsList>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
            {tab.count !== undefined && <TabCount value={tab.count} />}
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value}>
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
