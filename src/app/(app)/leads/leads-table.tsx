"use client";

import Link from "next/link";
import {
  Table, THead, TBody, TR, TH, TD, Badge, statusTone, EmptyState,
} from "@/components/ui";
import {
  BulkBar, SelectAllBox, SelectBox, useSelection,
} from "@/components/bulk-bar";
import { bulkAssignLeads, bulkSetLeadStatus } from "@/server/bulk";
import { formatMoney, formatDate, humanize } from "@/lib/utils";

type Lead = Record<string, any> & { id: string };

/**
 * The leads list, with selection.
 *
 * Split out of the page because selection needs client state. The rows are
 * still fetched and scoped on the server — this only renders what it is given.
 */
export function LeadsTable({
  leads,
  users,
  canWrite,
}: {
  leads: Lead[];
  users: { id: string; fullName: string }[];
  canWrite: boolean;
}) {
  const selection = useSelection(leads);

  if (leads.length === 0) {
    return (
      <EmptyState
        title="No leads match"
        description="Leads arrive from campaigns, the website, or a partner referral."
      />
    );
  }

  return (
    <>
      {canWrite && (
        <BulkBar
          selected={selection.ids}
          onClear={selection.clear}
          actions={[
            {
              label: "Assign",
              placeholder: "Choose an owner…",
              options: users.map((u) => ({ value: u.id, label: u.fullName })),
              run: (ids, value) => bulkAssignLeads(ids, value),
            },
            {
              label: "Set status",
              placeholder: "Choose a status…",
              options: [
                "NEW", "ASSIGNED", "ATTEMPTED_CONTACT",
                "CONTACTED", "QUALIFIED", "NURTURING",
              ].map((s) => ({ value: s, label: humanize(s) })),
              run: (ids, value) => bulkSetLeadStatus(ids, value),
            },
          ]}
        />
      )}

      <Table>
        <THead>
          <TR>
            {canWrite && (
              <TH className="w-8">
                <SelectAllBox
                  total={leads.length}
                  selected={selection.ids.length}
                  onToggle={selection.toggleAll}
                />
              </TH>
            )}
            <TH>Lead</TH>
            <TH>Company</TH>
            <TH>Source</TH>
            <TH>Referred by</TH>
            <TH>Owner</TH>
            <TH className="text-right">Est. value</TH>
            <TH>Follow up</TH>
            <TH>Status</TH>
            <TH className="text-right">Actions</TH>
          </TR>
        </THead>
        <TBody>
          {leads.map((l) => {
            const overdue = l.nextFollowUpAt && new Date(l.nextFollowUpAt) < new Date();
            return (
              <TR key={l.id} className={selection.isSelected(l.id) ? "bg-primary/5" : undefined}>
                {canWrite && (
                  <TD>
                    <SelectBox
                      checked={selection.isSelected(l.id)}
                      onChange={(on) => selection.toggle(l.id, on)}
                      label={`Select ${l.firstName} ${l.lastName}`}
                    />
                  </TD>
                )}
                <TD>
                  <Link href={`/leads/${l.id}`} className="font-medium hover:underline">
                    {l.firstName} {l.lastName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{l.leadNumber}</p>
                </TD>
                <TD className="text-sm">{l.companyName ?? "—"}</TD>
                <TD className="text-sm text-muted-foreground">
                  {l.leadSource ?? "—"}
                  {l.campaign && <p className="text-xs">{l.campaign.name}</p>}
                </TD>
                <TD className="text-sm">
                  {l.referredByPartner ? (
                    <Link
                      href={`/partners/${l.referredByPartner.id}`}
                      className="text-primary hover:underline"
                    >
                      {l.referredByPartner.displayName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TD>
                <TD className="text-sm text-muted-foreground">{l.owner?.fullName}</TD>
                <TD className="text-right tabular">{formatMoney(l.estimatedValue)}</TD>
                <TD className={`text-sm ${overdue ? "text-red-600 dark:text-red-400" : ""}`}>
                  {formatDate(l.nextFollowUpAt)}
                </TD>
                <TD>
                  <Badge tone={statusTone(l.status)}>{humanize(l.status)}</Badge>
                </TD>
                <TD className="whitespace-nowrap text-right text-sm">
                  <Link href={`/leads/${l.id}/edit`} className="text-primary hover:underline">
                    {l.status === "CONVERTED" ? "View" : "Edit"}
                  </Link>
                  {l.status !== "CONVERTED" && (
                    <>
                      <span className="px-1.5 text-muted-foreground">·</span>
                      <Link
                        href={`/leads/${l.id}/convert`}
                        className="text-primary hover:underline"
                      >
                        Convert
                      </Link>
                    </>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}
