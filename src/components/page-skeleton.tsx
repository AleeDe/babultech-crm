/**
 * Placeholder shown while a page's data is in flight.
 *
 * Every list screen has the same skeleton — header, stat row, table — so one
 * component covers all of them rather than a hand-written loading.tsx per
 * module that would drift from the real layout.
 */
export function PageSkeleton({
  tiles = 4,
  rows = 6,
}: {
  tiles?: number;
  rows?: number;
}) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-4 w-96 max-w-full rounded bg-muted/60" />
      </div>

      {tiles > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: tiles }).map((_, i) => (
            <div key={i} className="h-20 rounded-lg border bg-card" />
          ))}
        </div>
      )}

      <div className="mt-6 rounded-lg border bg-card">
        <div className="border-b p-4">
          <div className="h-9 w-full max-w-sm rounded bg-muted" />
        </div>
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4">
              <div className="h-4 flex-1 rounded bg-muted" />
              <div className="hidden h-4 w-24 rounded bg-muted/60 sm:block" />
              <div className="hidden h-4 w-20 rounded bg-muted/60 md:block" />
              <div className="h-5 w-16 rounded-full bg-muted/60" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
