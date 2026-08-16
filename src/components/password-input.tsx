"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui";

/**
 * Password field with a reveal toggle.
 *
 * The button is type="button" so it never submits the form it sits in, and it
 * is aria-hidden from the tab order's point of view only in the sense that it
 * carries an explicit label — screen readers announce the action, and the
 * pressed state tells them which way it is currently set.
 */
export function PasswordInput({
  name = "password",
  autoComplete = "current-password",
  required,
  placeholder,
}: {
  name?: string;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        className="pr-9"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 grid w-9 place-items-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
