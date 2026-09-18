"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { Button, Select } from "@/components/ui";
import { humanize } from "@/lib/utils";
import type { DateRange } from "@/lib/date-range";
import { DateRangeFilter } from "./date-range-filter";

const keys = ["resource", "project", "projectStatus", "health"] as const;

export function DeliveryFiltersBar({ range, options }: {
  range: DateRange;
  options: {
    resources: { id: string; name: string }[];
    projects: { id: string; name: string }[];
    statuses: string[];
    health: string[];
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const active = keys.filter((key) => params.get(key)).length;
  const navigate = (next: URLSearchParams) => startTransition(() => {
    router.replace(`${pathname}?${next}`, { scroll: false });
  });
  const fields = [
    { key: "resource", label: "Resource", all: "All resources", items: options.resources },
    { key: "project", label: "Project", all: "All projects", items: options.projects },
    { key: "projectStatus", label: "Project status", all: "All statuses", items: options.statuses.map((id) => ({ id, name: humanize(id) })) },
    { key: "health", label: "Project health", all: "All health", items: options.health.map((id) => ({ id, name: humanize(id) })) },
  ];

  return (
    <section aria-label="Delivery filters" aria-busy={pending} className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" />Filters{active > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{active}</span>}</h2>
        <Button type="button" variant="ghost" size="sm" disabled={pending || !active} onClick={() => {
          const next = new URLSearchParams(params.toString());
          keys.forEach((key) => next.delete(key));
          navigate(next);
        }}>Clear filters</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-44">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Period</p>
          <DateRangeFilter key={`${range.preset}-${range.from}-${range.to}-${range.days}`} range={range} showSummary={false} />
        </div>
        {fields.map((field) => {
          const selected = params.get(field.key) ?? "";
          return (
            <label key={field.key} className="min-w-0 flex-1 basis-40 text-xs font-medium text-muted-foreground">
              {field.label}
              <Select className="mt-1.5 h-9 w-full text-foreground" value={selected} disabled={pending} onChange={(e) => {
                const next = new URLSearchParams(params.toString());
                if (e.target.value) next.set(field.key, e.target.value);
                else next.delete(field.key);
                navigate(next);
              }}>
                <option value="">{field.all}</option>
                {selected && !field.items.some((item) => item.id === selected) && <option value={selected}>Unavailable selection</option>}
                {field.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </Select>
            </label>
          );
        })}
      </div>
      <p role="status" className="mt-3 text-xs text-muted-foreground">
        {pending ? "Updating delivery data…" : `${range.label} · Hours follow this period. Open work and allocations are current. Resource filters show individual contributions; budgets and milestones are for the whole project.`}
      </p>
    </section>
  );
}
