/**
 * Who is over-committed, before somebody promises a date.
 *
 * Utilisation on the delivery dashboard answers a different question: how many
 * hours were logged against capacity, which is a report on time already spent.
 * This looks forward instead. The plan asks for overload to be visible *before*
 * a manager commits to a date, and hours nobody has worked yet are the only
 * thing that can answer that.
 *
 * PLANNED HOURS ARE NOT LOGGED HOURS
 *
 * Everything here is an estimate someone typed on a task. A task with no
 * estimate contributes nothing and is counted separately, because a person with
 * six unestimated tasks looks free and is not. That count is reported rather
 * than guessed at: inventing an average would make the number look precise
 * while being wrong.
 */

export const DEFAULT_DAILY_HOURS = 8;

/** Monday-to-Friday. Leave and holidays are not modelled yet; see unknowns. */
export function isWorkingDay(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function workingDaysBetween(from: string, to: string) {
  if (to < from) return 0;
  let count = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isWorkingDay(date)) count += 1;
  }
  return count;
}

export type PlannedTask = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  assignedUserId: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  completionPercent: number;
  status: string;
};

export type CapacityWindow = { from: string; to: string };

/**
 * The hours of a task that fall inside a window.
 *
 * Remaining work is spread evenly across the task's working days. Even
 * spreading is a simplification, and a deliberate one: the alternative is
 * asking people to schedule hours per day, which nobody will keep up to date,
 * and a stale precise number is worse than an honest rough one.
 *
 * Work already done is excluded via completionPercent, so a task half finished
 * only carries its remaining half forward.
 */
export function taskHoursInWindow(task: PlannedTask, window: CapacityWindow): number {
  if (task.estimatedHours == null || task.estimatedHours <= 0) return 0;
  if (["COMPLETED", "CANCELLED"].includes(task.status)) return 0;

  const remaining = task.estimatedHours * (1 - Math.min(Math.max(task.completionPercent, 0), 100) / 100);
  if (remaining <= 0) return 0;

  // A task with no dates cannot be placed on a calendar, so it is not counted
  // here. It is surfaced separately instead.
  if (!task.dueDate) return 0;

  // Without a start date, treat the work as landing on its due date: that is
  // the only day we actually know about.
  const start = task.startDate && task.startDate <= task.dueDate ? task.startDate : task.dueDate;
  const totalDays = workingDaysBetween(start, task.dueDate);
  if (totalDays === 0) {
    // The whole span is a weekend. Count it on the due date so the work does
    // not silently vanish from the forecast.
    return start <= window.to && task.dueDate >= window.from ? remaining : 0;
  }

  const overlapFrom = start > window.from ? start : window.from;
  const overlapTo = task.dueDate < window.to ? task.dueDate : window.to;
  if (overlapTo < overlapFrom) return 0;

  const daysInWindow = workingDaysBetween(overlapFrom, overlapTo);
  return (remaining / totalDays) * daysInWindow;
}

export type PersonCapacity = {
  userId: string;
  fullName: string;
  /** Hours of planned work landing in the window. */
  plannedHours: number;
  /** Working days in the window times their daily hours. */
  availableHours: number;
  /** Planned as a percentage of available. Null when they have no availability. */
  loadPercent: number | null;
  /** Over 100% of available hours. */
  overloaded: boolean;
  /** Assigned, open, and carrying no estimate - invisible to the forecast. */
  unestimatedTasks: number;
  /** Open tasks assigned to them with no due date, which cannot be scheduled. */
  undatedTasks: number;
  tasks: { id: string; name: string; projectId: string; projectName: string; hours: number; dueDate: string | null }[];
};

/**
 * Planned load per person for a window.
 *
 * People with no planned work are included: a forecast that hides the person
 * with nothing booked is no use to whoever is deciding who takes the next job.
 */
export function capacityForWindow(
  people: { id: string; fullName: string; dailyHours?: number | null }[],
  tasks: PlannedTask[],
  window: CapacityWindow,
): PersonCapacity[] {
  const days = workingDaysBetween(window.from, window.to);

  return people.map((person) => {
    const theirs = tasks.filter((t) => t.assignedUserId === person.id);
    const open = theirs.filter((t) => !["COMPLETED", "CANCELLED"].includes(t.status));

    const withHours = theirs
      .map((task) => ({ task, hours: taskHoursInWindow(task, window) }))
      .filter((entry) => entry.hours > 0)
      .sort((a, b) => b.hours - a.hours);

    const plannedHours = Math.round(withHours.reduce((sum, e) => sum + e.hours, 0) * 10) / 10;
    const availableHours = days * (person.dailyHours ?? DEFAULT_DAILY_HOURS);

    return {
      userId: person.id,
      fullName: person.fullName,
      plannedHours,
      availableHours,
      loadPercent: availableHours > 0 ? Math.round((plannedHours / availableHours) * 100) : null,
      overloaded: availableHours > 0 && plannedHours > availableHours,
      unestimatedTasks: open.filter((t) => t.estimatedHours == null || t.estimatedHours <= 0).length,
      undatedTasks: open.filter((t) => !t.dueDate).length,
      tasks: withHours.map(({ task, hours }) => ({
        id: task.id,
        name: task.name,
        projectId: task.projectId,
        projectName: task.projectName,
        hours: Math.round(hours * 10) / 10,
        dueDate: task.dueDate,
      })),
    };
  });
}

/** Most loaded first: the point of the page is to find who cannot take more. */
export function byLoad(rows: PersonCapacity[]) {
  return [...rows].sort((a, b) =>
    (b.loadPercent ?? -1) - (a.loadPercent ?? -1) || a.fullName.localeCompare(b.fullName),
  );
}

/** Windows worth looking at, as offsets in weeks from the start of this week. */
export const CAPACITY_WEEKS = [1, 2, 4, 8] as const;
export type CapacityWeeks = (typeof CAPACITY_WEEKS)[number];

/** Monday of the week containing `date`. */
export function weekStart(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return addDays(date, -offset);
}

export function windowFor(today: string, weeks: CapacityWeeks): CapacityWindow {
  const from = weekStart(today);
  return { from, to: addDays(from, weeks * 7 - 1) };
}

/** A short line for the top of the page, so the numbers are read correctly. */
export function summarise(rows: PersonCapacity[]) {
  const overloaded = rows.filter((r) => r.overloaded);
  const free = rows.filter((r) => r.loadPercent != null && r.loadPercent < 60);
  return {
    people: rows.length,
    overloaded: overloaded.length,
    free: free.length,
    unestimated: rows.reduce((sum, r) => sum + r.unestimatedTasks, 0),
    undated: rows.reduce((sum, r) => sum + r.undatedTasks, 0),
  };
}
