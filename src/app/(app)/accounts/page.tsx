import Link from "next/link";
import { Plus } from "lucide-react";
import { listAccounts } from "@/server/crm";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge, statusTone,
  EmptyState, Input, Select, Button, Forbidden
} from "@/components/ui";
import { humanize } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { ExportButton } from "@/components/export-button";

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; accountType?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.ACCOUNT_READ)) return <Forbidden what="accounts" />;

  const params = await searchParams;
  const accounts = await listAccounts(params);

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Customers, prospects, partners and vendors - one organisation record, many roles."
      >
        <ExportButton entity="accounts" params={{ search: params.search, accountType: params.accountType }} />
        <Button asChild>
          <Link href="/accounts/new">
            <Plus className="h-4 w-4" /> New account
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-[220px] flex-1">
            <Input name="search" placeholder="Search name or number…" defaultValue={params.search} />
          </div>
          <Select name="accountType" defaultValue={params.accountType ?? ""} className="w-48">
            <option value="">All types</option>
            {["PROSPECT", "CUSTOMER", "PARTNER", "VENDOR", "COMPETITOR", "OTHER"].map((t) => (
              <option key={t} value={t}>{humanize(t)}</option>
            ))}
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {accounts.length === 0 ? (
          <EmptyState title="No accounts match" description="Accounts are created directly, or automatically when you convert a lead." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Account</TH>
                <TH>Type</TH>
                <TH priority="secondary">Owner</TH>
                <TH priority="tertiary">Industry</TH>
                <TH className="text-right" priority="tertiary">Contacts</TH>
                <TH className="text-right" priority="tertiary">Deals</TH>
                <TH className="text-right" priority="tertiary">Cases</TH>
                <TH priority="secondary">Health</TH>
              </TR>
            </THead>
            <TBody>
              {accounts.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link href={`/accounts/${a.id}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{a.accountNumber}</p>
                  </TD>
                  <TD>
                    <Badge tone={a.accountType === "CUSTOMER" ? "success" : "neutral"}>
                      {humanize(a.accountType)}
                    </Badge>
                    {a.partner && (
                      <Link href={`/partners/${a.partner?.id}`} className="mt-0.5 block text-xs text-primary hover:underline">
                        {humanize(a.partner?.partnerType)} partner
                      </Link>
                    )}
                  </TD>
                  <TD priority="secondary" className="text-sm text-muted-foreground">{a.owner?.fullName}</TD>
                  <TD priority="tertiary" className="text-sm text-muted-foreground">{a.industry ?? "—"}</TD>
                  <TD priority="tertiary" className="text-right tabular">{a._count.contacts}</TD>
                  <TD priority="tertiary" className="text-right tabular">{a._count.opportunities}</TD>
                  <TD priority="tertiary" className="text-right tabular">{a._count.cases}</TD>
                  <TD priority="secondary">
                    {a.customerHealth ? (
                      <Badge tone={statusTone(a.customerHealth)}>{humanize(a.customerHealth)}</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </>
  );
}
