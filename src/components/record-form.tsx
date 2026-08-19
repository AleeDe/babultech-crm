"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardFooter, Button, Alert, Field } from "@/components/ui";

/**
 * Field errors travel by context rather than a render prop.
 *
 * A function child cannot cross the server/client boundary — React rejects it
 * with "Functions are not valid as a child of Client Components" — and these
 * forms are laid out in server components.
 */
const FieldErrors = createContext<Record<string, string[] | undefined>>({});

type Result =
  | { ok: true; data?: { id: string } }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/**
 * Shell for the simple create forms.
 *
 * Holds the three things every one of them needs and none of them should
 * reimplement: the pending state, the error strip, and routing on success.
 * Field-level errors are handed back down so each input can show its own.
 */
export function RecordForm({
  action,
  redirectTo,
  submitLabel = "Create",
  children,
}: {
  action: (values: never) => Promise<Result>;
  redirectTo: string;
  submitLabel?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});

  function onSubmit(formData: FormData) {
    setError(null);
    setFieldErrors({});

    // Unchecked boxes are absent from FormData rather than false, so the
    // schema would see undefined and fall back to its default. Reading them
    // off the form element keeps the submitted value honest.
    const values: Record<string, unknown> = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value === "string") values[key] = value === "" ? null : value;
    }

    start(async () => {
      const result = await action(values as never);
      if (result.ok) {
        router.push(redirectTo);
        router.refresh();
        return;
      }
      setError(result.error);
      setFieldErrors(result.fieldErrors ?? {});
    });
  }

  return (
    <form action={onSubmit}>
      <Card>
        <CardContent className="space-y-5 p-6">
          {error && <Alert tone="danger">{error}</Alert>}
          <FieldErrors.Provider value={fieldErrors}>{children}</FieldErrors.Provider>
        </CardContent>
        <CardFooter className="flex justify-end gap-2 border-t bg-muted/30 p-4">
          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

/** Field wrapper that shows the server's message for that input. */
export function FormField({
  label,
  name,
  required,
  hint,
  help,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  hint?: string;
  /** Hover/focus explanation beside the label. See Field. */
  help?: string;
  children: ReactNode;
}) {
  const message = useContext(FieldErrors)[name]?.[0];

  return (
    <div>
      <Field label={label} required={required} help={help}>
        {children}
      </Field>
      {message ? (
        <p className="mt-1 text-xs text-destructive">{message}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
