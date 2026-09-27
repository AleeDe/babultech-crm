"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Badge, Button, Table, THead, TBody, TR, TH, TD, statusTone } from "@/components/ui";
import { formatDate, humanize } from "@/lib/utils";
import type { PartnerLead } from "@/server/partner-leads";

/** The lead list, with ticks for choosing who to email. */
export function PartnerLeadsTable({ leads }: { leads: PartnerLead[] }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const mailable = leads.filter((l) => l.email && !l.convertedAt);
  const all = mailable.length > 0 && mailable.every((l) => chosen.has(l.id));

  function toggle(id: string) {
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      {chosen.size > 0 && (
        <div className="flex items-center justify-between gap-3 border-b bg-muted/40 px-4 py-2 text-sm">
          <span>{chosen.size} chosen</span>
          <Button asChild size="sm">
            <Link href={`/portal/leads/email?ids=${[...chosen].join(",")}`}>
              <Mail className="h-4 w-4" /> Email them
            </Link>
          </Button>
        </div>
      )}
      <Table>
        <THead>
          <TR>
            <TH className="w-8">
              <input
                type="checkbox"
                aria-label="Choose every lead with an email address"
                checked={all}
                onChange={() => setChosen(all ? new Set() : new Set(mailable.map((l) => l.id)))}
                className="h-4 w-4 rounded border-input"
              />
            </TH>
            <TH>Lead</TH>
            <TH priority="secondary">Company</TH>
            <TH priority="tertiary">Contact</TH>
            <TH>Status</TH>
            <TH priority="secondary">Follow up</TH>
          </TR>
        </THead>
        <TBody>
          {leads.map((lead) => {
            const overdue = lead.nextFollowUpAt && !lead.convertedAt && new Date(lead.nextFollowUpAt) <= new Date();
            return (
              <TR key={lead.id}>
                <TD>
                  <input
                    type="checkbox"
                    aria-label={`Choose ${lead.firstName} ${lead.lastName}`}
                    checked={chosen.has(lead.id)}
                    onChange={() => toggle(lead.id)}
                    disabled={!lead.email || Boolean(lead.convertedAt)}
                    className="h-4 w-4 rounded border-input"
                  />
                </TD>
                <TD>
                  <Link href={`/portal/leads/${lead.id}`} className="text-sm font-medium hover:underline">
                    {lead.firstName} {lead.lastName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{lead.leadNumber}</p>
                </TD>
                <TD className="text-sm" priority="secondary">{lead.companyName ?? "—"}</TD>
                <TD className="text-sm" priority="tertiary">
                  {lead.email ?? lead.phone ?? lead.whatsapp ?? "—"}
                </TD>
                <TD>
                  <Badge tone={statusTone(lead.status)}>{humanize(lead.status)}</Badge>
                </TD>
                <TD className={`whitespace-nowrap text-sm ${overdue ? "font-medium text-amber-600 dark:text-amber-400" : ""}`} priority="secondary">
                  {lead.nextFollowUpAt && !lead.convertedAt ? formatDate(lead.nextFollowUpAt) : "—"}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </>
  );
}
