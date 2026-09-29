import Link from "next/link";
import { Activity, Mail, MessageSquare, Megaphone, PenLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { getTimeline, type TimelineEntity, type TimelineItem } from "@/server/timeline";

const ICON: Record<TimelineItem["kind"], React.ComponentType<{ className?: string }>> = {
  activity: Activity,
  email: Mail,
  note: MessageSquare,
  touch: Megaphone,
  change: PenLine,
};

/** Everything that happened on a record, in one list, newest first. */
export async function Timeline({ entityType, id, className }: { entityType: TimelineEntity; id: string; className?: string }) {
  const items = await getTimeline(entityType, id).catch(() => []);
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">Activities, emails, notes, campaign touches and key changes, newest first.</p>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has happened here yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l pl-5">
            {items.map((item) => {
              const Icon = ICON[item.kind];
              const title = item.href ? (
                <Link href={item.href} className="hover:underline">{item.title}</Link>
              ) : (
                item.title
              );
              return (
                <li key={item.id} className="relative">
                  <span className="absolute -left-[27px] top-0.5 grid h-4 w-4 place-items-center rounded-full bg-card ring-1 ring-border">
                    <Icon className="h-2.5 w-2.5 text-muted-foreground" />
                  </span>
                  <p className="text-sm font-medium">{title}</p>
                  {item.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.detail}</p>}
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDateTime(item.at)}
                    {item.by ? ` · ${item.by}` : ""}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
