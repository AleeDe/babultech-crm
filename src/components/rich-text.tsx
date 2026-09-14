import { looksLikeHtml } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

/**
 * Displays a description that may be rich text or may be plain.
 *
 * Everything written before descriptions became rich text is a plain string
 * with real newlines in it. Rendering those through `dangerouslySetInnerHTML`
 * would collapse the line breaks and, worse, would interpret any stray angle
 * bracket a person had typed. So the value decides how it is shown: markup is
 * rendered as markup, anything else as pre-wrapped text.
 *
 * The HTML path is safe because nothing reaches the database without passing
 * through sanitizeRichText on write — see src/lib/rich-text.ts. This component
 * deliberately does not sanitise again at render time: doing so would hide a
 * write path that had skipped the cleaning, and the bug would live on unseen
 * until something else rendered the same value.
 */
export function RichText({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  if (!value || value.trim() === "") {
    return <p className="text-sm text-muted-foreground">Nothing recorded.</p>;
  }

  if (!looksLikeHtml(value)) {
    return <p className={cn("whitespace-pre-wrap text-sm", className)}>{value}</p>;
  }

  return (
    <div
      className={cn(
        "text-sm",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:font-mono [&_pre]:text-xs",
        "[&_a]:text-primary [&_a]:underline",
        "[&>*+*]:mt-2",
        className,
      )}
      // Safe by construction: sanitizeRichText cleans every value on write.
      dangerouslySetInnerHTML={{ __html: value }}
    />
  );
}
