"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { markNotificationsRead, type NotificationItem } from "@/server/notifications";

export function NotificationList({ items }: { items: (NotificationItem & { when: string })[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [read, setRead] = useState<Set<string>>(new Set(items.filter((i) => i.readAt).map((i) => i.id)));
  const unread = items.filter((i) => !read.has(i.id)).length;

  async function open(item: NotificationItem) {
    if (!read.has(item.id)) {
      setRead((s) => new Set(s).add(item.id));
      await markNotificationsRead([item.id]).catch(() => {});
    }
    if (item.link) router.push(item.link);
  }

  return (
    <>
      {unread > 0 && (
        <div className="flex justify-end border-b px-4 py-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await markNotificationsRead();
                setRead(new Set(items.map((i) => i.id)));
                router.refresh();
              })
            }
          >
            Mark all read
          </Button>
        </div>
      )}
      <ul>
        {items.map((item) => {
          const isRead = read.has(item.id);
          return (
            <li key={item.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => void open(item)}
                className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-accent", !isRead && "bg-primary/5")}
              >
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", isRead ? "bg-transparent" : "bg-primary")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", !isRead && "font-medium")}>{item.title}</span>
                  {item.body && <span className="mt-0.5 block text-sm text-muted-foreground">{item.body}</span>}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {item.when}
                    {item.actorName ? ` · ${item.actorName}` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
