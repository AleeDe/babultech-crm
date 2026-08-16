import { Download } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Downloads the current list as CSV.
 *
 * A plain link, not a fetch: the browser handles the download, so there is no
 * blob to build or revoke and it works with JavaScript disabled. The filters
 * on screen are carried through, so the file matches what the reader is
 * looking at rather than the whole table.
 */
export function ExportButton({
  entity,
  params,
  label = "Export",
}: {
  entity: string;
  /** The page's own searchParams, so the export honours the active filters. */
  params?: Record<string, string | undefined>;
  label?: string;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) query.set(key, value);
  }

  const href = `/api/export/${entity}${query.size ? `?${query}` : ""}`;

  return (
    <Button asChild variant="outline">
      {/* download is advisory — the server sets Content-Disposition too, which
          is what actually names the file. */}
      <a href={href} download>
        <Download className="h-4 w-4" /> {label}
      </a>
    </Button>
  );
}
