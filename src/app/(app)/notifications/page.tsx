import Link from "next/link";
import { Settings } from "lucide-react";
import { requireUser } from "@/lib/authz";
import { listNotifications } from "@/server/notifications";
import { PageHeader, Card, Button, EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { NotificationList } from "./notification-list";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; page?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const unreadOnly = params.show === "unread";
  const page = Math.max(1, Number(params.page) || 1);
  const { items, hasMore } = await listNotifications({ unreadOnly, page });

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Work that came your way, and changes to the records you follow. Kept for 90 days."
      >
        <Button asChild variant="outline">
          <Link href="/notifications/settings">
            <Settings className="h-4 w-4" /> Settings
          </Link>
        </Button>
      </PageHeader>

      <div className="mb-4 flex gap-2 text-sm">
        <Link
          href="/notifications"
          className={!unreadOnly ? "rounded-md bg-primary/10 px-3 py-1.5 font-medium text-primary" : "rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent"}
        >
          All
        </Link>
        <Link
          href="/notifications?show=unread"
          className={unreadOnly ? "rounded-md bg-primary/10 px-3 py-1.5 font-medium text-primary" : "rounded-md px-3 py-1.5 text-muted-foreground hover:bg-accent"}
        >
          Unread
        </Link>
      </div>

      <Card>
        {items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={unreadOnly ? "All caught up" : "No notifications yet"}
              description={unreadOnly ? "Nothing unread." : "When something is assigned to you, or a record you follow changes, it shows here."}
            />
          </div>
        ) : (
          <NotificationList
            items={items.map((i) => ({ ...i, when: formatDateTime(i.createdAt) }))}
          />
        )}
      </Card>

      {(page > 1 || hasMore) && (
        <div className="mt-4 flex justify-between">
          {page > 1 ? (
            <Button asChild variant="outline" size="sm">
              <Link href={`/notifications?${new URLSearchParams({ ...(unreadOnly ? { show: "unread" } : {}), page: String(page - 1) })}`}>Newer</Link>
            </Button>
          ) : <span />}
          {hasMore && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/notifications?${new URLSearchParams({ ...(unreadOnly ? { show: "unread" } : {}), page: String(page + 1) })}`}>Older</Link>
            </Button>
          )}
        </div>
      )}
    </>
  );
}
