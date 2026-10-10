import { Fragment } from "react";
import { boldParts } from "@/lib/contract-format";

/**
 * A contract's words as they are read and printed: the wording, with
 * **double asterisks** shown as bold, then the special notes in a highlighted
 * section. Bold is the only formatting, and it is rendered as elements, never
 * as HTML, so nothing typed into a contract can run as a page.
 */
export function ContractText({ body, notes, className = "" }: { body: string; notes?: string | null; className?: string }) {
  return (
    <div className={className}>
      <div className="whitespace-pre-wrap" data-contract-text>{withBold(body)}</div>
      {notes?.trim() ? (
        <section className="mt-8 rounded-md border-2 border-current/20 bg-black/[0.03] p-4" style={{ breakInside: "avoid" }} data-special-notes>
          <h3 className="mb-2 font-sans text-sm font-bold uppercase tracking-wide">Special notes</h3>
          <div className="whitespace-pre-wrap font-semibold">{withBold(notes)}</div>
        </section>
      ) : null}
    </div>
  );
}

/** "**this**" as <strong>this</strong>; everything else as plain text. */
export function withBold(text: string) {
  return boldParts(text).map((part, i) => (part.bold ? <strong key={i}>{part.text}</strong> : <Fragment key={i}>{part.text}</Fragment>));
}
