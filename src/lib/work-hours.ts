/**
 * Turning clock times into a duration, in one place.
 *
 * time_log keeps `hours` as the billable figure — approval, invoicing, cost and
 * utilisation all read it — and start/end times as an optional record of when
 * the work happened. Those two must never disagree, so wherever both times are
 * given the hours are derived here rather than trusted from the form.
 *
 * Kept out of the server actions so the arithmetic, which is the part most
 * likely to be wrong, can be tested directly.
 */

/** "HH:MM" (or "HH:MM:SS") to minutes past midnight. Null if unparseable. */
export function parseClock(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;

  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

/**
 * Hours between two clock times, to two decimal places.
 *
 * An end at or before the start is read as crossing midnight rather than as an
 * error: a shift from 22:00 to 02:00 is four hours, and someone working late is
 * exactly the person least likely to tolerate a form arguing with them. The one
 * case that is rejected is start === end, which is a zero-length entry and
 * almost certainly a slip.
 *
 * Rounded because `hours` is DECIMAL(8,2) — leaving the extra precision to be
 * truncated by the database would make the stored figure disagree with the one
 * shown in the form.
 */
export function hoursBetween(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const from = parseClock(start);
  const to = parseClock(end);
  if (from === null || to === null) return null;
  if (from === to) return null;

  const minutes = to > from ? to - from : 24 * 60 - from + to;
  return Math.round((minutes / 60) * 100) / 100;
}

/** "9:00" → "09:00", so what is stored matches what a TIME column returns. */
export function normaliseClock(value: string | null | undefined): string | null {
  const minutes = parseClock(value);
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface Span {
  startTime: string | null;
  endTime: string | null;
}

/**
 * Which of a day's entries overlap in clock time.
 *
 * Returns the indexes that clash, so the caller can point at them. This warns
 * rather than refuses: two things genuinely do run at once — a code review
 * during a meeting — and wrongly blocking an honest entry costs more than an
 * occasional double-count that a reviewer can see and query.
 *
 * Entries without times cannot overlap anything, since there is nothing to
 * compare; a day of untimed durations is not a conflict, just less detail.
 *
 * A span crossing midnight is compared as two pieces — the part before midnight
 * and the part after — because a single range whose end is numerically smaller
 * than its start would otherwise appear to overlap nothing at all.
 */
export function findOverlaps(spans: Span[]): number[] {
  const ranges = spans.map((s) => {
    const from = parseClock(s.startTime);
    const to = parseClock(s.endTime);
    if (from === null || to === null || from === to) return null;
    return to > from
      ? [[from, to]]
      : [
          [from, 24 * 60],
          [0, to],
        ];
  });

  const clashing = new Set<number>();

  for (let i = 0; i < ranges.length; i++) {
    const a = ranges[i];
    if (!a) continue;
    for (let j = i + 1; j < ranges.length; j++) {
      const b = ranges[j];
      if (!b) continue;
      // Touching ends do not overlap: 09:00–11:00 and 11:00–12:00 are back to
      // back, which is the normal shape of a working day.
      const hit = a.some(([aStart, aEnd]) =>
        b.some(([bStart, bEnd]) => aStart < bEnd && bStart < aEnd),
      );
      if (hit) {
        clashing.add(i);
        clashing.add(j);
      }
    }
  }

  return [...clashing].sort((x, y) => x - y);
}
