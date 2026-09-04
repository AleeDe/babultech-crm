"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * The way back out of a record or a form.
 *
 * Every detail page, every new form and every edit screen is somewhere you
 * arrived from somewhere else, and until now the only way back was the
 * browser's own button or the sidebar — which drops you at the top of a list
 * you had scrolled, on a page you had filtered.
 *
 * `href` is given wherever the parent is knowable — a lead's parent is the
 * lead list, a task's is its project — because a real link can be opened in a
 * new tab, shows its target on hover, and works when the page was arrived at
 * directly from a bookmark or an emailed URL. That last case is why history is
 * not the default: router.back() on a freshly opened tab goes nowhere.
 *
 * Without `href` it falls back to history, which is right for the screens with
 * no single parent — an approval reached from a dashboard tile belongs to
 * whatever sent you there.
 */
export function BackLink({
  href,
  label,
}: {
  href?: string;
  label: string;
}) {
  const router = useRouter();

  const className =
    "-ml-1 mb-3 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  if (href) {
    return (
      <Link href={href} className={className}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.back()} className={className}>
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}
