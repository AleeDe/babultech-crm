/**
 * The stages a deal moves through, in order, with the probability each one
 * suggests. Kept out of the server modules because a "use server" file may only
 * export async functions - a plain const there passes tsc and fails the build.
 */
export const DEAL_STAGES = [
  "DISCOVERY", "QUALIFICATION", "REQUIREMENTS", "SOLUTION_PROPOSED", "QUOTE_SUBMITTED",
  "NEGOTIATION", "VERBAL_CONFIRMATION", "CLOSED_WON", "CLOSED_LOST", "ON_HOLD",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

/** The stages a deal is still being worked in. */
export const OPEN_DEAL_STAGES: readonly DealStage[] = DEAL_STAGES.filter(
  (s) => s !== "CLOSED_WON" && s !== "CLOSED_LOST",
);
