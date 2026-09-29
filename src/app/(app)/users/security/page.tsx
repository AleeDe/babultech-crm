import Link from "next/link";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { listLoginEvents } from "@/server/security";
import { LoginHistory } from "@/components/login-history";
import { PageHeader, Forbidden } from "@/components/ui";
import { cn } from "@/lib/utils";

const FILTERS = [
  { value: "", label: "Everything" },
  { value: "SIGN_IN_FAILED", label: "Failed sign-ins" },
  { value: "VIEW_AS_START", label: "View as" },
  { value: "SIGN_IN", label: "Sign-ins" },
];

export default async function SecurityHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="the security history" />;
  const { type } = await searchParams;
  const eventType = FILTERS.some((f) => f.value === type) ? type : undefined;
  const events = await listLoginEvents({ eventType, limit: 300 });

  return (
    <>
      <PageHeader
        backTo="/users"
        backLabel="Back to users"
        title="Security history"
        description="Every sign-in, failed sign-in and sign-out, and every View as session with its reason. The latest 300."
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value ? `/users/security?type=${f.value}` : "/users/security"}
            className={cn(
              "rounded-md px-3 py-1.5",
              (eventType ?? "") === f.value ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <LoginHistory title="Events" events={events} showUser />
    </>
  );
}
