import { Eye } from "lucide-react";
import { getViewAs } from "@/lib/view-as";
import { exitViewAs } from "@/server/view-as";

const time = (iso: string) =>
  new Date(/[zZ]$/.test(iso) ? iso : `${iso}Z`).toLocaleTimeString("en-PK", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Karachi",
  });

/**
 * The banner across the top of every screen during View as, so there is never
 * any doubt whose view this is. Shown in the CRM and both portals.
 */
export async function ViewAsBanner() {
  const view = await getViewAs();
  if (!view) return null;
  return (
    <div
      role="status"
      className="sticky top-0 z-[60] flex flex-wrap items-center justify-center gap-x-4 gap-y-1 bg-amber-500 px-4 py-2 text-center text-sm font-medium text-amber-950"
    >
      <span className="inline-flex items-center gap-1.5">
        <Eye className="h-4 w-4" aria-hidden />
        YOU ARE VIEWING AS {view.targetName.toUpperCase()}
      </span>
      <span className="font-normal">
        Read-only. Started by {view.adminName} at {time(view.startedAt)}, ends at {time(view.expiresAt)}.
      </span>
      <form action={exitViewAs}>
        <button type="submit" className="rounded bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900">
          Exit View as
        </button>
      </form>
    </div>
  );
}
