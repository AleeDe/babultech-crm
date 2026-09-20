import Link from "next/link";
import { Plus, ShieldCheck, Handshake } from "lucide-react";
import { listUsers, getUserFormOptions } from "@/server/users";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, StatTile, Input, Select, Button, Forbidden,
} from "@/components/ui";
import { formatMoney, formatDateTime, humanize } from "@/lib/utils";

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; roleId?: string; status?: string }>;
}) {
  const me = await requireUser();
  if (!can(me, PERMISSIONS.ADMIN)) return <Forbidden what="user administration" />;

  const params = await searchParams;
  const [users, options] = await Promise.all([listUsers(params), getUserFormOptions()]);

  const active = users.filter((u) => u.status === "ACTIVE");
  const partners = users.filter((u) => u.partnerId);
  // role comes from an embedded join that RLS can withhold, so it may be null
  // even for a user that exists. Treating that as "not an admin" keeps the page
  // rendering instead of crashing on a permissions read.
  const admins = users.filter(
    (u) => u.role?.permissions?.includes("*") && u.status === "ACTIVE",
  );
  const noRates = active.filter((u) => !u.partnerId && (!u.costRate || !u.defaultBillingRate));

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with access to this portal. The role decides what they can do; the data scope decides how much of it they see."
      >
        <Button asChild>
          <Link href="/users/new">
            <Plus className="h-4 w-4" /> New user
          </Link>
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active users" value={String(active.length)} sublabel={`${users.length} total`} />
        <StatTile
          label="Administrators"
          value={String(admins.length)}
          tone={admins.length === 1 ? "warning" : "neutral"}
          sublabel={admins.length === 1 ? "Only one - add a second" : undefined}
        />
        <StatTile label="Partner logins" value={String(partners.length)} tone="info" />
        <StatTile
          label="Missing rates"
          value={String(noRates.length)}
          tone={noRates.length ? "warning" : "success"}
          sublabel="Their time costs nothing"
        />
      </div>

      <Card className="mt-6">
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-[220px] flex-1">
            <Input name="search" placeholder="Search name, email or employee number…" defaultValue={params.search} />
          </div>
          <Select name="roleId" defaultValue={params.roleId ?? ""} className="w-52">
            <option value="">All roles</option>
            {options.roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
          <Select name="status" defaultValue={params.status ?? ""} className="w-40">
            <option value="">All statuses</option>
            {["ACTIVE", "INACTIVE", "SUSPENDED"].map((s) => (
              <option key={s} value={s}>{humanize(s)}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {users.length === 0 ? (
          <EmptyState
            title="No users match"
            description="Give someone access by creating their login and assigning a role."
            action={
              <Button asChild>
                <Link href="/users/new">Create a user</Link>
              </Button>
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH priority="secondary">Type</TH>
                <TH priority="secondary">Role</TH>
                <TH priority="tertiary">Sees</TH>
                <TH priority="tertiary">Department</TH>
                <TH priority="tertiary">Reports to</TH>
                <TH priority="tertiary" className="text-right">Rates</TH>
                <TH priority="tertiary">Last signed in</TH>
                <TH priority="secondary">Status</TH>
              </TR>
            </THead>
            <TBody>
              {users.map((u) => {
                const isAdmin = u.role?.permissions?.includes("*") ?? false;
                return (
                  <TR key={u.id} className={u.status !== "ACTIVE" ? "opacity-60" : undefined}>
                    <TD>
                      <Link href={`/users/${u.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
                        {isAdmin && <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" />}
                        {u.partner && <Handshake className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
                        {u.fullName}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                      {/* Role and status are what an admin scans this list
                          for, so neither drops off a phone. */}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 sm:hidden">
                        <Badge tone={isAdmin ? "danger" : u.partner ? "warning" : "neutral"}>
                          {u.role?.name ?? "—"}
                        </Badge>
                        <Badge tone={statusTone(u.status)}>{humanize(u.status)}</Badge>
                      </div>
                    </TD>
                    <TD priority="secondary">
                      <Badge tone={u.userType === "INTERNAL" ? "neutral" : u.userType === "PARTNER" ? "warning" : "info"}>
                        {u.userType === "INTERNAL" ? "Employee" : u.userType === "PARTNER" ? "Partner" : "Customer"}
                      </Badge>
                    </TD>
                    <TD priority="secondary">
                      <Badge tone={isAdmin ? "danger" : u.partner ? "warning" : "neutral"}>
                        {(u.role?.name ?? "—")}
                      </Badge>
                      {u.partner && (
                        <Link
                          href={`/partners/${u.partner?.id}`}
                          className="mt-0.5 block text-xs text-primary hover:underline"
                        >
                          {u.partner?.displayName}
                        </Link>
                      )}
                    </TD>
                    <TD priority="tertiary" className="text-xs text-muted-foreground">{humanize((u.role?.dataScope ?? ""))}</TD>
                    <TD priority="tertiary" className="text-sm text-muted-foreground">{u.department?.name ?? "—"}</TD>
                    <TD priority="tertiary" className="text-sm text-muted-foreground">{u.manager?.fullName ?? "—"}</TD>
                    <TD priority="tertiary" className="whitespace-nowrap text-right text-xs text-muted-foreground">
                      {u.partnerId ? (
                        "—"
                      ) : (
                        <>
                          <p>Bill {formatMoney(u.defaultBillingRate)}</p>
                          <p>Cost {formatMoney(u.costRate)}</p>
                        </>
                      )}
                    </TD>
                    <TD priority="tertiary" className="text-sm text-muted-foreground">
                      {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"}
                    </TD>
                    <TD priority="secondary">
                      <Badge tone={statusTone(u.status)}>{humanize(u.status)}</Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
