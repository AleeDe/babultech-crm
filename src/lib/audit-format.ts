import { humanize } from "./utils";

/**
 * How a changed field is named in history: "projectManagerId" reads as
 * "Project manager", "ownerUserId" as "Owner". Safe for client components.
 */
export function auditFieldLabel(fieldName: string | null | undefined): string {
  if (!fieldName) return "Record";
  if (fieldName === "passwordHash") return "Password";
  const trimmed = (fieldName === "id" ? fieldName : fieldName.replace(/(User)?Id$/, "")) || fieldName;
  // camelCase as words; SNAKE_CASE goes through humanize as before.
  if (!/[a-z][A-Z]/.test(trimmed)) return humanize(trimmed);
  const words = trimmed.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
