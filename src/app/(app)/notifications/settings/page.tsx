import { requireUser } from "@/lib/authz";
import { getNotificationPreferences } from "@/server/notifications";
import { PageHeader } from "@/components/ui";
import { PreferencesForm } from "./preferences-form";

export default async function NotificationSettingsPage() {
  await requireUser();
  const preferences = await getNotificationPreferences();
  return (
    <>
      <PageHeader
        backTo="/notifications"
        backLabel="Back to notifications"
        title="Notification settings"
        description="Choose what shows under the bell and what also comes by email. Several notifications arriving together come as one email."
      />
      <PreferencesForm preferences={preferences} />
    </>
  );
}
