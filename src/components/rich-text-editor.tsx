"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  Heading2, Heading3, Quote, Code, Link2, Undo2, Redo2, Eraser,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small rich-text editor for description fields.
 *
 * Built on `contentEditable` and `document.execCommand` rather than pulling in
 * an editor framework. That is a deliberate trade: execCommand is deprecated
 * but still implemented everywhere, and the alternative is roughly 100–200KB of
 * JavaScript for a field that needs bold, lists and the occasional link. What
 * it buys — collaborative editing, schemas, custom nodes — is not what a task
 * description is for.
 *
 * The value is mirrored into a hidden input so the surrounding plain `<form>`
 * submits it like any other field, and no call site has to learn a new way to
 * read a form.
 *
 * **Nothing here is a security boundary.** Whatever this produces is sanitised
 * again on the server before it is stored — see sanitizeRichText in
 * src/lib/rich-text.ts. A browser can post any string it likes, so the cleaning
 * that matters is the one on write. Pasted content is stripped here too, but
 * only so the editor shows what will actually be saved.
 */
export function RichTextEditor({
  name,
  defaultValue = "",
  placeholder,
  rows = 6,
  id,
}: {
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
  /** Roughly how many lines tall to start. */
  rows?: number;
  id?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(defaultValue ?? "");
  const [isEmpty, setIsEmpty] = useState(!defaultValue || defaultValue.trim() === "");
  const generatedId = useId();
  const editorId = id ?? generatedId;

  // Set once. Writing innerHTML on every render would move the caret to the
  // start of the field on each keystroke.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (defaultValue && el.innerHTML !== defaultValue) {
      // Plain text written before this field held HTML keeps its line breaks.
      el.innerHTML = /<[a-z][\s\S]*>/i.test(defaultValue)
        ? defaultValue
        : defaultValue
            .split(/\n{2,}/)
            .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
            .join("");
      sync();
    }
    // Intentionally once: this seeds the field, it does not track the prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sync() {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    setValue(html);
    setIsEmpty(el.textContent?.trim() === "" && !html.includes("<li"));
  }

  function exec(command: string, arg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    sync();
  }

  function addLink() {
    const url = window.prompt("Link address", "https://");
    if (!url) return;
    // The server strips anything but http(s), mailto and tel, but refusing here
    // too means the person finds out immediately rather than on save.
    if (!/^(https?:|mailto:|tel:)/i.test(url)) {
      window.alert("Links must start with https://, http://, mailto: or tel:");
      return;
    }
    exec("createLink", url);
  }

  const tools: ({ key: string; icon: React.ReactNode; label: string; run: () => void } | "divider")[] = [
    { key: "bold", icon: <Bold className="h-3.5 w-3.5" />, label: "Bold", run: () => exec("bold") },
    { key: "italic", icon: <Italic className="h-3.5 w-3.5" />, label: "Italic", run: () => exec("italic") },
    { key: "underline", icon: <Underline className="h-3.5 w-3.5" />, label: "Underline", run: () => exec("underline") },
    { key: "strike", icon: <Strikethrough className="h-3.5 w-3.5" />, label: "Strikethrough", run: () => exec("strikeThrough") },
    "divider",
    { key: "h2", icon: <Heading2 className="h-3.5 w-3.5" />, label: "Heading", run: () => exec("formatBlock", "<h2>") },
    { key: "h3", icon: <Heading3 className="h-3.5 w-3.5" />, label: "Subheading", run: () => exec("formatBlock", "<h3>") },
    { key: "quote", icon: <Quote className="h-3.5 w-3.5" />, label: "Quote", run: () => exec("formatBlock", "<blockquote>") },
    { key: "code", icon: <Code className="h-3.5 w-3.5" />, label: "Code block", run: () => exec("formatBlock", "<pre>") },
    "divider",
    { key: "ul", icon: <List className="h-3.5 w-3.5" />, label: "Bulleted list", run: () => exec("insertUnorderedList") },
    { key: "ol", icon: <ListOrdered className="h-3.5 w-3.5" />, label: "Numbered list", run: () => exec("insertOrderedList") },
    { key: "link", icon: <Link2 className="h-3.5 w-3.5" />, label: "Add link", run: addLink },
    "divider",
    { key: "clear", icon: <Eraser className="h-3.5 w-3.5" />, label: "Clear formatting", run: () => exec("removeFormat") },
    { key: "undo", icon: <Undo2 className="h-3.5 w-3.5" />, label: "Undo", run: () => exec("undo") },
    { key: "redo", icon: <Redo2 className="h-3.5 w-3.5" />, label: "Redo", run: () => exec("redo") },
  ];

  return (
    <div className="rounded-md border border-input bg-card shadow-sm focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/30">
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
        {tools.map((t, i) =>
          t === "divider" ? (
            <span key={`d${i}`} aria-hidden className="mx-1 h-4 w-px bg-border" />
          ) : (
            <button
              key={t.key}
              type="button"
              title={t.label}
              aria-label={t.label}
              // onMouseDown, not onClick: clicking a button blurs the editor
              // and collapses the selection, so the command would apply to
              // nothing. Preventing the default keeps the selection alive.
              onMouseDown={(e) => { e.preventDefault(); t.run(); }}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t.icon}
            </button>
          ),
        )}
      </div>

      <div className="relative">
        {isEmpty && placeholder && (
          <p className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
            {placeholder}
          </p>
        )}
        <div
          ref={editorRef}
          id={editorId}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={placeholder ?? "Description"}
          onInput={sync}
          onBlur={sync}
          onPaste={(e) => {
            // Paste as the browser's own cleaned HTML where possible, falling
            // back to plain text. Either way the server sanitises again; this
            // just stops the editor showing markup that will not survive.
            e.preventDefault();
            const html = e.clipboardData.getData("text/html");
            const text = e.clipboardData.getData("text/plain");
            if (html) {
              document.execCommand("insertHTML", false, stripDangerous(html));
            } else {
              document.execCommand("insertText", false, text);
            }
            sync();
          }}
          className={cn(
            "prose-sm max-w-none px-3 py-2 text-sm outline-none",
            "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
            "[&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold",
            "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
            "[&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs",
            "[&_a]:text-primary [&_a]:underline",
            "[&>*+*]:mt-2",
          )}
          style={{ minHeight: `${rows * 1.5}rem` }}
        />
      </div>

      {/* What the surrounding form actually submits. */}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

/**
 * A first pass over pasted markup so the editor does not display something the
 * server is about to remove. Not the security boundary — see the note above.
 */
function stripDangerous(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|form|meta|link)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|meta|link)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')?\s*(javascript|data|vbscript):[^"'>\s]*("|')?/gi, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
