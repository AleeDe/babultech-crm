"use client";

import { useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * The wrapper around a filter strip that puts its fields into the URL.
 *
 * Deliberately not a `<form>`.
 *
 * Every screen renders inside AppShell, which is a client component, so React
 * owns any form beneath it — and React 19 treats a submit inside a client tree
 * as a Server Action, POSTing to the current path whatever the element's
 * `method` says. Next answers that POST with a 303, the redirected request
 * arrives without the Supabase auth cookie, `requireUser()` throws "Not signed
 * in", and the (app) layout's catch sends the browser to /login.
 *
 * The symptom is the worst kind: pressing Apply on a filter signs you out.
 * Neither `method="get"` nor `preventDefault()` in an onSubmit handler avoids
 * it — the action dispatch happens regardless of what the handler does, and the
 * native method is never consulted.
 *
 * So there is no form and no submit event to intercept. The fields sit in a
 * plain `<div>`, and Apply reads them straight out of the DOM and pushes a
 * query string. Enter still applies, because keydown is handled here too.
 *
 * The result is what the plain GET form was always meant to produce: filters in
 * the URL, so a filtered view can be bookmarked, shared and reloaded, and the
 * back button steps through it.
 */
export function FilterForm({
  children,
  className,
  /** Where to navigate. Defaults to the page the strip is on. */
  action,
}: {
  children: React.ReactNode;
  className?: string;
  action?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  const apply = () => {
    const root = ref.current;
    if (!root) return;

    const params = new URLSearchParams();
    root
      .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input[name], select[name]")
      .forEach((el) => {
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
          if (el.checked) params.set(el.name, el.value);
          return;
        }
        const v = el.value.trim();
        // An empty field means "no filter", which is the absence of the
        // parameter rather than an empty one — otherwise clearing a search box
        // leaves a trail of `?search=&status=` in the address bar.
        if (v) params.set(el.name, v);
      });

    const qs = params.toString();
    router.push(`${action ?? pathname}${qs ? `?${qs}` : ""}`);
  };

  return (
    <div
      ref={ref}
      className={className}
      onClick={(e) => {
        // The Apply button is a <button> with no form to submit, so its click is
        // caught here rather than through an onSubmit.
        const el = (e.target as HTMLElement).closest("button");
        if (el && !el.disabled) apply();
      }}
      onKeyDown={(e) => {
        // Enter in a text field is how people actually apply a search.
        if (e.key === "Enter") {
          e.preventDefault();
          apply();
        }
      }}
    >
      {children}
    </div>
  );
}
