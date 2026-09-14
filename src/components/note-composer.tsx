"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign } from "lucide-react";
import { Textarea } from "@/components/ui";
import { buildMentionToken } from "@/lib/mentions";
import { cn } from "@/lib/utils";

export interface MentionableUser {
  id: string;
  fullName: string;
  jobTitle: string | null;
}

/**
 * The note text box, with an @ picker.
 *
 * A plain textarea rather than a contentEditable surface. Note content is
 * stored and read as plain text everywhere in this system — the list preview,
 * the notification email, the export — and a mention is a token inside that
 * text, not markup. Keeping the input a textarea means what the person types is
 * exactly what is stored, and nothing can be pasted in that becomes markup.
 *
 * Typing `@` opens a list filtered by what follows it. Picking someone replaces
 * the typed fragment with the token; the person sees their colleague's name
 * because the token is rendered, not the raw form.
 */
export function NoteComposer({
  value,
  onChange,
  users,
  placeholder,
  rows = 3,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  users: MentionableUser[];
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  // Where the live `@fragment` starts, or null when we are not in one.
  const [anchor, setAnchor] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const matches =
    anchor === null
      ? []
      : users
          .filter((u) => u.fullName.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 6);

  useEffect(() => setHighlight(0), [query, anchor]);

  /**
   * Decide whether the caret sits inside an @fragment.
   *
   * The fragment runs from the most recent `@` back to a space or the start of
   * the text, and only counts when the `@` follows whitespace — so an email
   * address typed into a note does not open the picker.
   */
  function detect(el: HTMLTextAreaElement) {
    const caret = el.selectionStart ?? 0;
    const before = el.value.slice(0, caret);
    const at = before.lastIndexOf("@");

    if (at === -1) return setAnchor(null);
    const charBefore = at === 0 ? " " : before[at - 1];
    if (!/\s/.test(charBefore)) return setAnchor(null);

    const fragment = before.slice(at + 1);
    // A space ends the fragment; so does a token that has already been built.
    if (/[\s\]()]/.test(fragment) || fragment.length > 40) return setAnchor(null);

    setAnchor(at);
    setQuery(fragment);
  }

  function pick(user: MentionableUser) {
    const el = ref.current;
    if (!el || anchor === null) return;

    const caret = el.selectionStart ?? 0;
    const token = buildMentionToken(user.id, user.fullName);
    const next = `${value.slice(0, anchor)}${token} ${value.slice(caret)}`;
    onChange(next);
    setAnchor(null);
    setQuery("");

    // Put the caret after the inserted token rather than leaving it where the
    // fragment used to be, which would be mid-token.
    requestAnimationFrame(() => {
      const pos = anchor + token.length + 1;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        rows={rows}
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          detect(e.target);
        }}
        onClick={(e) => detect(e.currentTarget)}
        onKeyUp={(e) => {
          // Arrow keys move the caret, which can move it out of a fragment.
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) detect(e.currentTarget);
        }}
        onKeyDown={(e) => {
          if (anchor === null || matches.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => (h + 1) % matches.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => (h - 1 + matches.length) % matches.length);
          } else if (e.key === "Enter" || e.key === "Tab") {
            // Enter picks the highlighted person rather than adding a newline —
            // the picker being open is what makes that unambiguous.
            e.preventDefault();
            pick(matches[highlight]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setAnchor(null);
          }
        }}
        onBlur={() => {
          // Delayed so a click on the list lands before it closes.
          setTimeout(() => setAnchor(null), 150);
        }}
      />

      {anchor !== null && matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Mention a colleague"
          className="absolute z-20 mt-1 max-h-56 w-full max-w-xs overflow-auto rounded-md border bg-card p-1 shadow-lg"
        >
          {matches.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                // onMouseDown, not onClick: the textarea's blur would close the
                // list before a click could land.
                onMouseDown={(e) => { e.preventDefault(); pick(u); }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm",
                  i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                )}
              >
                <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate">
                  {u.fullName}
                  {u.jobTitle && (
                    <span className="text-xs text-muted-foreground"> · {u.jobTitle}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-1 text-xs text-muted-foreground">
        Type <span className="font-mono">@</span> to mention a colleague — they are notified.
      </p>
    </div>
  );
}
