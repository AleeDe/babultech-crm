import { requireUser } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
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

  const me = await prisma.user.findUniqueOrThrow({
    where: { id: session.id },
    include: {
      role: true,
      department: { select: { name: true } },
      manager: { select: { fullName: true } },
      partner: { select: { id: true, displayName: true, partnerNumber: true } },
    },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="My account" description="Your profile, your access, and your password.">
        <Badge tone="neutral">{me.role.name}</Badge>
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
                {me.partner.displayName} ({me.partner.partnerNumber})
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
              <DetailRow label="Role">{me.role.name}</DetailRow>
              <DetailRow label="You can see">
                {SCOPE_EXPLAINER[me.role.dataScope] ?? humanize(me.role.dataScope)}
              </DetailRow>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {me.role.permissions.map((p) => (
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
