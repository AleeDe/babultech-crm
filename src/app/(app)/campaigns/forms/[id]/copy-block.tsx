"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed"><code>{text}</code></pre>
      <Button
        size="sm"
        variant="outline"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            /* Select it by hand instead. */
          }
        }}
      >
        {copied ? "Copied" : "Copy code"}
      </Button>
    </div>
  );
}
