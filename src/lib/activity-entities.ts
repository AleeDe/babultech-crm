/**
 * What an activity may be attached to.
 *
 * Kept out of src/server/activities.ts because that file is a "use server"
 * module, and those may only export async functions - a plain const there is a
 * build error rather than a type error, so it passes tsc and fails the build.
 */
export const ACTIVITY_ENTITIES = [
  "Lead", "Contact", "Account", "Partner", "Opportunity",
] as const;

export type ActivityEntity = (typeof ACTIVITY_ENTITIES)[number];
