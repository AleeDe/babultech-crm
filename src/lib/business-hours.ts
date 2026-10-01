/**
 * Working time: adding working minutes to a moment, and counting the working
 * minutes between two moments, against a weekly schedule, a list of holidays
 * and a time zone.
 *
 * Used for SLA deadlines, which until now counted around the clock - a
 * four-hour first response to a case raised on Friday afternoon fell due on
 * Friday night. Now it falls due four working hours later: Monday morning.
 *
 * No date library: the zone's offset is read from Intl, day by day, so a zone
 * with summer time is still right on the day it changes.
 */

export type DaySchedule = { start: string; end: string } | null;
export type WeeklySchedule = Record<string, DaySchedule>;
export interface Holiday {
  date: string;
  name: string;
}
export interface WorkingCalendar {
  timezone: string;
  weeklySchedule: WeeklySchedule;
  holidays: Holiday[];
}

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MINUTE = 60_000;
const DAY = 86_400_000;

/** The zone's offset from UTC, in minutes, at a moment. */
function offsetMinutes(at: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / MINUTE);
}

/** The local calendar date, YYYY-MM-DD, of a moment in the zone. */
function localDate(at: Date, timezone: string): string {
  return new Date(at.getTime() + offsetMinutes(at, timezone) * MINUTE).toISOString().slice(0, 10);
}

/** The moment a local date and time happens in the zone. */
function localToUtc(date: string, time: string, timezone: string): Date {
  const [h, m] = time.split(":").map(Number);
  const naive = Date.parse(`${date}T00:00:00Z`) + (h * 60 + m) * MINUTE;
  const first = naive - offsetMinutes(new Date(naive), timezone) * MINUTE;
  // Once more, in case the guess crossed a change of offset.
  return new Date(naive - offsetMinutes(new Date(first), timezone) * MINUTE);
}

function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

/** The working window on a local date, or null for a day off. */
function windowOn(date: string, cal: WorkingCalendar): { open: Date; close: Date } | null {
  if (cal.holidays.some((h) => h.date === date)) return null;
  const weekday = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const day = cal.weeklySchedule?.[weekday];
  if (!day?.start || !day?.end || day.end <= day.start) return null;
  return { open: localToUtc(date, day.start, cal.timezone), close: localToUtc(date, day.end, cal.timezone) };
}

/** Whether a schedule has any working time at all; without it, time is elapsed time. */
export function hasWorkingTime(cal: WorkingCalendar | null | undefined): cal is WorkingCalendar {
  return Boolean(cal && Object.values(cal.weeklySchedule ?? {}).some((d) => d?.start && d?.end && d.end > d.start));
}

/** The moment `minutes` working minutes after `from`. */
export function addWorkingMinutes(from: Date, minutes: number, cal: WorkingCalendar | null | undefined): Date {
  if (!hasWorkingTime(cal)) return new Date(from.getTime() + minutes * MINUTE);
  let remaining = Math.max(0, minutes);
  let cursor = from;
  let date = localDate(from, cal.timezone);
  // Two years of days is more than any SLA; it stops a calendar with every day
  // a holiday from looping for ever.
  for (let i = 0; i < 730; i += 1) {
    const w = windowOn(date, cal);
    if (w) {
      if (cursor < w.open) cursor = w.open;
      if (cursor < w.close) {
        const available = (w.close.getTime() - cursor.getTime()) / MINUTE;
        if (remaining <= available) return new Date(cursor.getTime() + remaining * MINUTE);
        remaining -= available;
      }
    }
    date = nextDate(date);
    cursor = localToUtc(date, "00:00", cal.timezone);
  }
  return new Date(from.getTime() + minutes * MINUTE);
}

/** Working minutes between two moments. */
export function workingMinutesBetween(from: Date, to: Date, cal: WorkingCalendar | null | undefined): number {
  if (to <= from) return 0;
  if (!hasWorkingTime(cal)) return Math.round((to.getTime() - from.getTime()) / MINUTE);
  let total = 0;
  let date = localDate(from, cal.timezone);
  const last = localDate(to, cal.timezone);
  for (let i = 0; i < 3650; i += 1) {
    const w = windowOn(date, cal);
    if (w) {
      const start = Math.max(w.open.getTime(), from.getTime());
      const end = Math.min(w.close.getTime(), to.getTime());
      if (end > start) total += (end - start) / MINUTE;
    }
    if (date >= last) break;
    date = nextDate(date);
  }
  return Math.round(total);
}
