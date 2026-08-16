import { History } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/utils";

interface AuditRow {
  id: string;
  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  changedAt: string;
  changedBy?: { fullName?: string | null } | null;
}

/**
 * What changed on this record, and who changed it.
 *
 * Written on every audited update by lib/audit.ts, but only shown on a handful
 * of screens until now — the data was being kept and never read, which is the
 * same as not having it when someone asks why a figure moved.
 *
 * Values are shown as they were stored. A status is humanised because
 * CLOSED_WON reads badly; an amount is left alone because reformatting it here
 * would make the history disagree with the record it describes.
 */
export function AuditPanel({
  entries,
  title = "Change history",
}: {
  entries: AuditRow[];
  title?: string;
}) {
  const display = (value: string | null | undefined) => {
    if (value === null || value === undefined || value === "") return "empty";
    return /^[A-Z][A-Z_]+$/.test(value) ? humanize(value) : value;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No changes recorded yet. Edits to tracked fields appear here with who made them.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="border-b pb-3 last:border-0 last:pb-0">
                <p>
                  <span className="font-medium">
                    {entry.fieldName ? humanize(entry.fieldName) : "Record"}
                  </span>{" "}
                  <span className="text-muted-foreground">changed from</span>{" "}
                  <span className="font-medium">{display(entry.oldValue)}</span>{" "}
                  <span className="text-muted-foreground">to</span>{" "}
                  <span className="font-medium">{display(entry.newValue)}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {entry.changedBy?.fullName ?? "Unknown"} · {formatDateTime(entry.changedAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
