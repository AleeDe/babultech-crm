import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * The way back out of a record or a form.
 *
 * Every detail page, every new form and every edit screen is somewhere you
 * arrived from somewhere else, and until now the only way back was the
 * browser's own button or the sidebar — which drops you at the top of a list
 * you had scrolled, on a page you had filtered.
 *
 * A plain server component, deliberately. The first version was a client
 * component so it could offer router.back() when no parent was known, and that
 * one decision put a "use client" boundary inside PageHeader — which every
 * screen renders. Next then streamed the whole header in behind a Suspense
 * fallback, so the link sat inside a `<div hidden>` until hydration and was
 * simply missing on arrival.
 *
 * Nothing here needs the client: a link is a link. That also makes it a real
 * one — openable in a new tab, target visible on hover, and working on a page
 * reached from a bookmark or an emailed URL, where there is no history to go
 * back through anyway.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="-ml-1 mb-3 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
