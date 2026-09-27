import Link from "next/link";
import { Alert } from "@/components/ui";
import type { DuplicateRef } from "@/lib/duplicates";

/**
 * Why a save was refused - and, when it was refused because the person is
 * already on file, the way to the record that has them. Being told a lead
 * already exists is only half an answer without the means to open it.
 */
export function SaveError({
  error,
  duplicate,
}: {
  error: string | null;
  duplicate?: DuplicateRef | null;
}) {
  if (!error) return null;
  return (
    <Alert tone="danger">
      {error}
      {duplicate && (
        <>
          {" "}
          <Link href={duplicate.href} className="font-medium underline">
            Open {duplicate.label}
          </Link>
        </>
      )}
    </Alert>
  );
}
