"use client";

import { Bold } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Wraps the selected words in a textarea in **double asterisks**, which a
 * contract shows as bold. Pressing it again on a bold selection takes the
 * bold off. With nothing selected it inserts a pair to type between.
 */
export function BoldButton({ target, onChange }: { target: () => HTMLTextAreaElement | null; onChange?: (value: string) => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label="Bold"
      title="Bold: select words, then press. Shown as **words** here and in bold on the contract."
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const el = target();
        if (!el) return;
        const { selectionStart: a, selectionEnd: b, value } = el;
        const selected = value.slice(a, b);
        let next: string;
        let cursor: [number, number];
        if (selected.startsWith("**") && selected.endsWith("**") && selected.length >= 4) {
          next = value.slice(0, a) + selected.slice(2, -2) + value.slice(b);
          cursor = [a, b - 4];
        } else if (value.slice(a - 2, a) === "**" && value.slice(b, b + 2) === "**") {
          next = value.slice(0, a - 2) + selected + value.slice(b + 2);
          cursor = [a - 2, b - 2];
        } else {
          next = value.slice(0, a) + `**${selected}**` + value.slice(b);
          cursor = [a + 2, b + 2];
        }
        // Set the value the way React notices, so a controlled textarea updates too.
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(el, next);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        onChange?.(next);
        el.focus();
        el.setSelectionRange(cursor[0], cursor[1]);
      }}
    >
      <Bold className="h-4 w-4" /> Bold
    </Button>
  );
}
