import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkingCalendar, Holiday } from "./business-hours";

/**
 * The working calendar an SLA policy keeps: its own business hours, or the
 * default ones, with their holidays. Null when there are none, in which case
 * deadlines count around the clock as before.
 */
export async function loadWorkingCalendar(
  db: Pick<SupabaseClient, "from">,
  businessHoursId?: string | null,
): Promise<WorkingCalendar | null> {
  const query = db.from("business_hours").select("timezone, weeklySchedule, holidayCalendar").eq("active", true);
  const { data } = businessHoursId
    ? await query.eq("id", businessHoursId).maybeSingle()
    : await query.eq("isDefault", true).limit(1).maybeSingle();
  if (!data) return null;
  const holidays = Array.isArray(data.holidayCalendar) ? (data.holidayCalendar as Holiday[]) : [];
  return {
    timezone: (data.timezone as string) || "Asia/Karachi",
    weeklySchedule: (data.weeklySchedule as WorkingCalendar["weeklySchedule"]) ?? {},
    holidays: holidays.filter((h) => h && /^\d{4}-\d{2}-\d{2}$/.test(h.date)),
  };
}
