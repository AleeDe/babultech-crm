import { requireUser } from "@/lib/authz";
import { getPreferences } from "@/server/preferences";
import { START_PAGES, timeZoneList } from "@/lib/start-pages";
import { PreferencesForm } from "./preferences-form";

/** The preferences card, for any of the three account pages. */
export async function PreferencesSection() {
  const [me, prefs] = await Promise.all([requireUser(), getPreferences()]);
  return <PreferencesForm initial={prefs} startPages={START_PAGES[me.userType] ?? START_PAGES.INTERNAL} zones={timeZoneList()} />;
}
