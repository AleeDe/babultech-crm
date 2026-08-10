"use client";

import Link from "next/link";
import { ShieldAlert, RotateCw } from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";

/**
 * Authorization failures reach here as thrown AuthorizationErrors. React
 * scrubs error messages in production, so we key off the digest-free name
 * where we have it and otherwise show the neutral version — either way the
 * user gets a sentence rather than a stack trace.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const denied =
    error.name === "AuthorizationError" ||
    error.message.includes("permission") ||
    error.message.includes("Not signed in");

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center py-20 text-center">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-4 p-8">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-muted">
            <ShieldAlert className="h-6 w-6 text-muted-foreground" />
          </span>

          <div>
            <h1 className="text-lg font-semibold">
              {denied ? "You do not have access to this" : "Something went wrong"}
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {denied
                ? "Your role does not include this screen. If you think it should, ask an administrator to change your role."
                : "The page could not be loaded. Trying again often works; if it does not, the error has been logged."}
            </p>
          </div>

          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/">Back to the dashboard</Link>
            </Button>
            {!denied && (
              <Button onClick={reset}>
                <RotateCw className="h-4 w-4" /> Try again
              </Button>
            )}
          </div>

          {error.digest && (
            <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
