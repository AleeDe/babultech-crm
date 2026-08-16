import { requireUser } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import { one } from "@/lib/decimal";
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, Badge, DetailRow,
} from "@/components/ui";
import { formatDateTime, humanize } from "@/lib/utils";
import { ChangePasswordForm } from "./profile-client";

const SCOPE_EXPLAINER: Record<string, string> = {
  OWN: "Only records you own",
  TEAM: "Your team's records",
  DEPARTMENT: "Your department's records",
  ALL: "Every record in the system",
};

export default async function ProfilePage() {
  const session = await requireUser();

  const db = await supabaseServer();

  const { data: row } = await db
    .from("app_user")
    .select(
      `*,
       role:security_role ( * ),
       department:app_user_departmentId_fkey ( name ),
       manager:managerUserId ( fullName ),
       partner:app_user_partnerId_fkey ( id, displayName, partnerNumber )`,
    )
    .eq("id", session.id)
    .single();

  if (!row) throw new Error("Your account could not be loaded.");

  const me = {
    ...row,
    role: one(row.role as never),
    department: one(row.department as never),
    manager: one(row.manager as never),
    partner: one(row.partner as never),
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="My account" description="Your profile, your access, and your password.">
        <Badge tone="neutral">{me.role?.name}</Badge>
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <DetailRow label="Name">{me.fullName}</DetailRow>
            <DetailRow label="Email">{me.email}</DetailRow>
            <DetailRow label="Job title">{me.jobTitle ?? "—"}</DetailRow>
            <DetailRow label="Phone">{me.phone ?? "—"}</DetailRow>
            {me.partner ? (
              <DetailRow label="Partner">
                {me.partner?.displayName} ({me.partner?.partnerNumber})
              </DetailRow>
            ) : (
              <>
                <DetailRow label="Employee number">{me.employeeNumber ?? "—"}</DetailRow>
                <DetailRow label="Department">{me.department?.name ?? "—"}</DetailRow>
                <DetailRow label="Reports to">{me.manager?.fullName ?? "—"}</DetailRow>
              </>
            )}
            <DetailRow label="Last signed in">
              {me.lastLoginAt ? formatDateTime(me.lastLoginAt) : "This is your first session"}
            </DetailRow>
            <p className="pt-2 text-xs text-muted-foreground">
              Ask an administrator to change anything above — you can only change your own password.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your access</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <DetailRow label="Role">{me.role?.name}</DetailRow>
              <DetailRow label="You can see">
                {SCOPE_EXPLAINER[me.role?.dataScope] ?? humanize(me.role?.dataScope)}
              </DetailRow>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {(me.role?.permissions ?? []).map((p: string) => (
                  <Badge key={p} tone={p === "*" ? "danger" : "neutral"} className="font-mono">
                    {p === "*" ? "everything" : p}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}
