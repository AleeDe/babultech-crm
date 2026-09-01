"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const requested = searchParams.get(param);
  // An unknown value in the URL falls back to the first tab rather than
  // rendering an empty page: the parameter is user-editable, and a typo in a
  // shared link should not produce a blank screen.
  const active = tabs.some((t) => t.value === requested)
    ? (requested as string)
    : tabs[0]?.value;

  function select(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    // The first tab is the default, so it is left out of the URL — a clean
    // address for the common case.
    if (value === tabs[0]?.value) next.delete(param);
    else next.set(param, value);

    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
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
