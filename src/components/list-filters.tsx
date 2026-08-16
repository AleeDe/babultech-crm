import { Search } from "lucide-react";
import { Input, Select, Button, Card } from "@/components/ui";

/**
 * The filter strip above a list.
 *
 * A plain GET form, so the current search lives in the URL: the page can be
 * bookmarked, shared and reloaded, and the back button behaves. That matters
 * more than the keystroke-by-keystroke filtering a client component would give,
 * and it costs no JavaScript.
 */
export interface FilterSelect {
  name: string;
  /** Shown when nothing is chosen — "All statuses", "Any type". */
  allLabel: string;
  value?: string;
  options: { value: string; label: string }[];
  className?: string;
}

export function ListFilters({
  searchPlaceholder = "Search…",
  searchValue,
  selects = [],
  children,
}: {
  searchPlaceholder?: string;
  searchValue?: string;
  selects?: FilterSelect[];
  children?: React.ReactNode;
}) {
  return (
    <Card className="mb-6">
      <form className="flex flex-wrap items-end gap-3 p-4">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="search"
            type="search"
            defaultValue={searchValue}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="pl-9"
          />
        </div>

        {selects.map((select) => (
          <Select
            key={select.name}
            name={select.name}
            defaultValue={select.value ?? ""}
            aria-label={select.allLabel}
            className={select.className ?? "w-44"}
          >
            <option value="">{select.allLabel}</option>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ))}

        {children}

        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
    </Card>
  );
}

/** Enum values as select options, with the SHOUTY_CASE turned into words. */
export function optionsFrom(values: readonly string[]): { value: string; label: string }[] {
  return values.map((value) => ({
    value,
    label: value
      .toLowerCase()
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" "),
  }));
}
