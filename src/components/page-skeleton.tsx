import { cn } from "@/lib/utils";

/**
 * Placeholder shown while a page's data is in flight.
 *
 * The point of a skeleton is not decoration — it is telling someone the shape of
 * what is coming, so the page does not jump when it arrives. That only works if
 * the skeleton matches the real layout, which is why there are variants rather
 * than one generic block: a detail page that flashes a table skeleton and then
 * renders two columns of fields is worse than no skeleton at all.
 *
 * The sweep is a `.skeleton` class rather than `animate-pulse`. Pulse dims every
 * block in unison, which reads as the page flickering; a directional sweep reads
 * as loading, because it implies progress moving through the content. It stops
 * entirely under `prefers-reduced-motion`.
 */

/** One shimmering block. Everything below is composed from this. */
function Bar({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded", className)} />;
}

function Header() {
  return (
    <div className="mb-6 space-y-2">
      <Bar className="h-7 w-48" />
      <Bar className="h-4 w-96 max-w-full opacity-60" />
    </div>
  );
}

/** A row of stat tiles, as every list and dashboard screen opens with. */
function Tiles({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4">
          <Bar className="h-3 w-24 opacity-60" />
          <Bar className="mt-2.5 h-7 w-20" />
          <Bar className="mt-2 h-3 w-28 opacity-60" />
        </div>
      ))}
    </div>
  );
}

/**
 * The list screens: filters, then rows.
 *
 * Row widths vary slightly down the list. Identical bars read as a rendering
 * artefact; uneven ones read as text that has not arrived yet, which is what
 * they stand in for.
 */
export function PageSkeleton({
  tiles = 4,
  rows = 6,
}: {
  tiles?: number;
  rows?: number;
}) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Header />
      {tiles > 0 && <Tiles count={tiles} />}

      <div className="mt-6 rounded-xl border bg-card">
        <div className="border-b p-4">
          <Bar className="h-9 w-full max-w-sm" />
        </div>
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <Bar className="h-4 flex-1" />
              <Bar className="hidden h-4 w-24 opacity-60 sm:block" />
              <Bar className="hidden h-4 w-20 opacity-60 md:block" />
              <Bar className="h-5 w-16 rounded-full opacity-60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * A record screen: title, stat row, then two columns of panels.
 *
 * Used for leads, opportunities, accounts, projects and the rest — the shape
 * they share, rather than the table shape they do not.
 */
export function DetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Bar className="h-7 w-56" />
          <Bar className="h-4 w-40 opacity-60" />
        </div>
        <div className="flex gap-2">
          <Bar className="h-9 w-24" />
          <Bar className="h-9 w-20" />
        </div>
      </div>

      <Tiles count={4} />

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {[0, 1].map((col) => (
          <div key={col} className="rounded-xl border bg-card p-4">
            <Bar className="h-4 w-32" />
            <div className="mt-4 space-y-3.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i}>
                  <Bar className="h-3 w-20 opacity-60" />
                  <Bar className="mt-1.5 h-4 w-44 max-w-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A form screen. Fields sit in a two-column grid with a full-width text area
 * near the end, which is the shape almost every create and edit form here takes.
 */
export function FormSkeleton({ fields = 8 }: { fields?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Header />
      <div className="rounded-xl border bg-card p-5">
        <div className="grid gap-5 sm:grid-cols-2">
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i}>
              <Bar className="h-3 w-24 opacity-60" />
              <Bar className="mt-1.5 h-9 w-full" />
            </div>
          ))}
        </div>
        <div className="mt-5">
          <Bar className="h-3 w-24 opacity-60" />
          <Bar className="mt-1.5 h-20 w-full" />
        </div>
        <div className="mt-5 flex justify-end gap-2 border-t pt-5">
          <Bar className="h-9 w-20" />
          <Bar className="h-9 w-28" />
        </div>
      </div>
    </div>
  );
}

/** The dashboard: tiles, then a wide panel beside a narrow one. */
export function DashboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Header />
      <div className="mb-6 flex gap-2 border-b pb-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bar key={i} className="h-6 w-20 opacity-60" />
        ))}
      </div>

      <Tiles count={4} />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-4 lg:col-span-2">
          <Bar className="h-4 w-36" />
          <div className="mt-4 space-y-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Bar className="h-3 w-32 opacity-60" />
                <Bar className="h-6 flex-1" />
                <Bar className="h-3 w-16 opacity-60" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <Bar className="h-4 w-28" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <Bar className="h-4 flex-1" />
                <Bar className="h-4 w-14 opacity-60" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
