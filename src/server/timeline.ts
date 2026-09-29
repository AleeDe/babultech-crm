"use server";

import { supabaseServer } from "@/lib/supabase";
import { requireUser } from "@/lib/authz";
import { listActivitiesFor } from "./activities";
import { listNotes } from "./notes";
import { getAuditTrail } from "@/lib/audit";
import { interactionLabel } from "@/lib/marketing";
import { mentionsToPlain } from "@/lib/mentions";

/**
 * One timeline for a record: what was done (activities and emails), what was
 * said (notes), what they did with our campaigns (touches) and what changed
 * (stage, status, owner, deletion), newest first.
 *
 * Every source is read through the person's own session and the same checks
 * its own panel uses, so the timeline never shows more than those panels.
 */

export type TimelineEntity = "Lead" | "Contact" | "Account" | "Opportunity";

export interface TimelineItem {
  id: string;
  at: string;
  kind: "activity" | "email" | "note" | "touch" | "change";
  title: string;
  detail: string | null;
  by: string | null;
  href: string | null;
}

/** Changes worth a line of their own; every other field edit stays in the history panel. */
const KEY_FIELDS = new Set(["status", "stage", "ownerUserId", "deletedAt", "emailOptOut", "amount", "expectedCloseDate", "accountType", "customerStatus"]);

const FIELD_LABEL: Record<string, string> = {
  status: "Status",
  stage: "Stage",
  ownerUserId: "Owner",
  deletedAt: "Deleted",
  emailOptOut: "Email opt-out",
  amount: "Value",
  expectedCloseDate: "Expected close",
  accountType: "Account type",
  customerStatus: "Customer status",
};

const words = (v: string | null) => (v ? v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "empty");

export async function getTimeline(entityType: TimelineEntity, id: string, limit = 60): Promise<TimelineItem[]> {
  await requireUser();
  const db = await supabaseServer();
  const safe = <T,>(p: Promise<T>, empty: T) => p.catch(() => empty);

  const [activities, notes, audit, touches, emails] = await Promise.all([
    safe(listActivitiesFor(entityType, id), []),
    safe(listNotes(entityType, id), []),
    safe(getAuditTrail(entityType, id, 100), []),
    entityType === "Lead" || entityType === "Contact"
      ? safe(
          Promise.resolve(
            db.from("campaign_interaction")
              .select("id, interactionType, occurredAt, details, campaign ( id, name ), createdBy:app_user!campaign_interaction_createdById_fkey ( fullName )")
              .eq(entityType === "Lead" ? "leadId" : "contactId", id)
              .order("occurredAt", { ascending: false })
              .limit(50),
          ).then((r) => r.data ?? []),
          [],
        )
      : Promise.resolve([]),
    safe(
      Promise.resolve(
        db.from("email")
          .select("id, subject, direction, status, toAddresses, sentReceivedAt, createdAt")
          .eq("relatedEntityType", entityType)
          .eq("relatedEntityId", id)
          .order("createdAt", { ascending: false })
          .limit(50),
      ).then((r) => r.data ?? []),
      [],
    ),
  ]);

  const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T | null;
  const items: TimelineItem[] = [];

  for (const a of activities) {
    const isEmail = a.activityType === "EMAIL";
    const status = isEmail
      ? a.bouncedAt ? "bounced" : a.clickedAt ? "clicked" : a.openedAt ? "opened" : a.deliveredAt ? "delivered" : a.sentAt ? "sent" : "waiting to send"
      : a.status === "OPEN" ? "open" : a.status?.toLowerCase();
    items.push({
      id: `a:${a.id}`,
      at: (a.completedAt ?? a.startAt ?? a.sentAt ?? a.createdAt) as string,
      kind: isEmail ? "email" : "activity",
      title: isEmail ? `Email: ${a.subject}` : `${words(a.activityType)}: ${a.subject}`,
      detail: [status, a.outcome ?? a.description].filter(Boolean).join(" · ") || null,
      by: a.owner?.fullName ?? null,
      href: `/activities/${a.id}`,
    });
  }
  for (const n of notes) {
    items.push({
      id: `n:${n.id}`,
      at: n.createdAt,
      kind: "note",
      title: n.title ? `Note: ${n.title}` : "Note",
      detail: mentionsToPlain(n.content).slice(0, 300),
      by: n.createdBy?.fullName ?? null,
      href: null,
    });
  }
  for (const t of touches as Record<string, unknown>[]) {
    const campaign = one<{ id: string; name: string }>(t.campaign);
    items.push({
      id: `t:${t.id}`,
      at: t.occurredAt as string,
      kind: "touch",
      title: interactionLabel(t.interactionType as string) + (campaign ? ` - ${campaign.name}` : ""),
      detail: (t.details as string | null)?.slice(0, 300) ?? null,
      by: one<{ fullName: string }>(t.createdBy)?.fullName ?? null,
      href: campaign ? `/campaigns/${campaign.id}` : null,
    });
  }
  for (const e of emails as Record<string, unknown>[]) {
    items.push({
      id: `e:${e.id}`,
      at: (e.sentReceivedAt ?? e.createdAt) as string,
      kind: "email",
      title: `${e.direction === "INBOUND" ? "Email received" : "Email"}: ${e.subject ?? "(no subject)"}`,
      detail: [((e.toAddresses as string[] | null) ?? []).join(", "), (e.status as string | null)?.toLowerCase()].filter(Boolean).join(" · ") || null,
      by: null,
      href: null,
    });
  }
  for (const c of audit as Record<string, any>[]) {
    if (!KEY_FIELDS.has(c.fieldName)) continue;
    const label = FIELD_LABEL[c.fieldName] ?? c.fieldName;
    const change =
      c.fieldName === "deletedAt"
        ? c.newValue ? "Moved to the recycle bin" : "Restored from the recycle bin"
        : c.fieldName === "ownerUserId" ? "Owner changed"
        : `${label}: ${words(c.oldValue)} → ${words(c.newValue)}`;
    items.push({
      id: `c:${c.id}`,
      at: c.changedAt,
      kind: "change",
      title: change,
      detail: null,
      by: c.changedBy?.fullName ?? null,
      href: null,
    });
  }

  const ms = (iso: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`).getTime();
  return items.filter((i) => i.at).sort((a, b) => ms(b.at) - ms(a.at)).slice(0, limit);
}
