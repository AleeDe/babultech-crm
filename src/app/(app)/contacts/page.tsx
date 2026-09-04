import Link from "next/link";
import { Plus } from "lucide-react";
import { listContacts } from "@/server/crm";
import {
  PageHeader, Card, Table, THead, TBody, TR, TH, TD, Badge,
  EmptyState, Input, Button, Select, Forbidden
} from "@/components/ui";
import { humanize } from "@/lib/utils";
import { requireUser, can, PERMISSIONS } from "@/lib/authz";
import { ExportButton } from "@/components/export-button";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; filter?: string }>;
}) {
  const _me = await requireUser();
  if (!can(_me, PERMISSIONS.ACCOUNT_READ)) return <Forbidden what="contacts" />;

  const params = await searchParams;
  const contacts = await listContacts({
    search: params.search,
    unaffiliatedOnly: params.filter === "unaffiliated",
  });

  return (
    <>
      <PageHeader
        title="Contacts"
        description="People. A contact may belong to an account, or stand alone - an individual partner has no company behind them."
      >
        <ExportButton entity="contacts" params={{ search: params.search }} />
        <Button asChild>
          <Link href="/contacts/new">
            <Plus className="h-4 w-4" /> New contact
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <form className="flex flex-wrap items-end gap-3 border-b p-4">
          <div className="min-w-[220px] flex-1">
            <Input name="search" placeholder="Search name or email…" defaultValue={params.search} />
          </div>
          <Select name="filter" defaultValue={params.filter ?? ""} className="w-56">
            <option value="">All contacts</option>
            <option value="unaffiliated">No company (individuals only)</option>
          </Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {contacts.length === 0 ? (
          <EmptyState title="No contacts match" description="Contacts arrive with lead conversion, or you can add them to an account directly." />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH priority="secondary">Company</TH>
                <TH priority="tertiary">Title</TH>
                <TH>Email</TH>
                <TH priority="secondary">Phone</TH>
                <TH priority="tertiary">Role</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {contacts.map((c) => (
                <TR key={c.id}>
                  <TD>
                    <Link href={`/contacts/${c.id}`} className="font-medium hover:underline">
                      {c.firstName} {c.lastName}
                    </Link>
                    {c.isPrimary && <Badge tone="info" className="ml-2">Primary</Badge>}
                    {c.partnerAsPerson && (
                      <Link href={`/partners/${c.partnerAsPerson.id}`} className="ml-2">
                        <Badge tone="success">
                          {humanize(c.partnerAsPerson.partnerType)} partner
                        </Badge>
                      </Link>
                    )}
                  </TD>
                  <TD priority="secondary" className="text-sm">
                    {c.account ? (
                      <Link href={`/accounts/${c.account?.id}`} className="hover:underline">
                        {c.account?.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">Independent</span>
                    )}
                  </TD>
                  <TD priority="tertiary" className="text-sm text-muted-foreground">{c.jobTitle ?? "—"}</TD>
                  <TD className="text-sm">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a>
                    ) : "—"}
                  </TD>
                  <TD priority="secondary" className="text-sm text-muted-foreground">{c.mobile ?? c.phone ?? "—"}</TD>
                  <TD priority="tertiary" className="text-sm text-muted-foreground">{c.contactRole ?? "—"}</TD>
                  <TD className="text-right">
                    <Link href={`/contacts/${c.id}/edit`} className="text-sm text-primary hover:underline">
                      Edit
                    </Link>
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
