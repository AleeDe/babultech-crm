import { z } from "zod";

export const CALL_OUTCOMES = ["NO_ANSWER", "CONNECTED", "CALLBACK_REQUESTED", "WRONG_NUMBER"] as const;
export const CALL_QUEUE_FILTERS = ["due", "today", "unscheduled", "upcoming", "all"] as const;
export type CallQueueFilter = (typeof CALL_QUEUE_FILTERS)[number];
export const callSchema = z.object({
  requestId: z.string().uuid(),
  leadId: z.string().uuid(),
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().trim().min(1, "Record the conversation or next action.").max(4000),
  followUpAt: z.string().datetime().refine((v) => new Date(v).getTime() > Date.now(), "Choose a future follow-up time."),
});

/** Calling desk uses the agency's Pakistan time, independently of browser TZ. */
export function pakistanInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+05:00`);
  if (!Number.isFinite(date.getTime())) return null;
  if (new Date(date.getTime() + 5 * 3600000).toISOString().slice(0, 16) !== value) return null;
  return date.toISOString();
}

export function pakistanDayEnd(now: Date): string {
  const day = new Date(now.getTime() + 5 * 3600000).toISOString().slice(0, 10);
  return new Date(`${day}T23:59:59.999+05:00`).toISOString();
}

export function callQueueBucket(followUpAt: string | null, now: Date): Exclude<CallQueueFilter, "all"> {
  if (!followUpAt) return "unscheduled";
  const due = new Date(followUpAt).getTime();
  if (!Number.isFinite(due)) return "unscheduled";
  if (due <= now.getTime()) return "due";
  return due <= new Date(pakistanDayEnd(now)).getTime() ? "today" : "upcoming";
}
