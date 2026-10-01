"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { PERMISSIONS, authorize, requirePermission } from "@/lib/authz";
import { emailKey, phoneKey } from "@/lib/duplicates";
import {
  MERGE_FIELDS, MERGE_NOUN, companyNameKey, domainKey, taxKey,
  type CandidateGroup, type MergeCandidate, type MergeEntity,
} from "@/lib/record-merge";
import type { ActionResult } from "./partners";

/**
 * Finding and merging duplicate contacts and accounts. The merge itself is
 * merge_contacts() / merge_accounts() in the database, so moving the linked
 * records, retiring the duplicates and writing the history happen together.
 */

const CONTACT_COLUMNS = "id, firstName, lastName, accountId, jobTitle, department, email, phone, mobile, whatsapp, contactRole, createdAt, account:account!contact_accountId_fkey ( name )";
const ACCOUNT_COLUMNS = "id, accountNumber, name, accountType, industry, website, mainPhone, taxNumberNtn, employeeCount, annualRevenue, creditLimit, paymentTermsDays, description, createdAt";

// Plain strings: a union of the two tables is too complex for the type checker.
const tableOf = (entity: MergeEntity): string => entity;
const columnsOf = (entity: MergeEntity): string => (entity === "contact" ? CONTACT_COLUMNS : ACCOUNT_COLUMNS);

const text = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());

function toCandidate(entity: MergeEntity, row: Record<string, unknown>, extra: { partnerAccounts?: Set<string>; loginContacts?: Set<string> } = {}): MergeCandidate {
  const values: Record<string, string> = {};
  for (const f of MERGE_FIELDS[entity]) values[f.key] = text(row[f.key]);
  const display: Record<string, string> = {};
  const completeness = Object.values(values).filter(Boolean).length;
  if (entity === "contact") {
    const account = (Array.isArray(row.account) ? row.account[0] : row.account) as { name?: string } | null;
    if (values.accountId) display.accountId = account?.name ?? "Another account";
    return {
      id: row.id as string,
      title: `${text(row.firstName)} ${text(row.lastName)}`.trim(),
      subtitle: [account?.name, text(row.email) || text(row.phone) || text(row.mobile)].filter(Boolean).join(" · "),
      createdAt: row.createdAt as string,
      values,
      display,
      completeness,
      keepOnly: extra.loginContacts?.has(row.id as string) ? "Has a portal login" : undefined,
    };
  }
  return {
    id: row.id as string,
    title: text(row.name),
    subtitle: [text(row.accountNumber), text(row.accountType).toLowerCase(), text(row.website)].filter(Boolean).join(" · "),
    createdAt: row.createdAt as string,
    values,
    display,
    completeness,
    keepOnly: extra.partnerAccounts?.has(row.id as string) ? "Is a partner" : undefined,
  };
}

async function loadExtras(entity: MergeEntity, ids: string[]) {
  const db = await supabaseServer();
  if (!ids.length) return {};
  if (entity === "contact") {
    const { data } = await db.from("app_user").select("contactId").in("contactId", ids);
    return { loginContacts: new Set((data ?? []).map((u) => u.contactId as string)) };
  }
  const { data } = await db.from("partner").select("accountId").in("accountId", ids);
  return { partnerAccounts: new Set((data ?? []).map((p) => p.accountId as string)) };
}

/**
 * Records that look like the same contact or company, grouped. Contacts match
 * on email, on any number's last nine digits, or on the same name at the same
 * account; accounts on name (legal form ignored), website, tax number or phone.
 */
export async function findDuplicates(entity: MergeEntity): Promise<CandidateGroup[]> {
  await requirePermission(PERMISSIONS.ACCOUNT_READ);
  const db = await supabaseServer();
  const { data, error } = await db
    .from(tableOf(entity))
    .select(columnsOf(entity))
    .is("deletedAt", null)
    .order("createdAt", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`Could not look for duplicates: ${error.message}`);
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  const byKey = new Map<string, { label: string; ids: string[] }>();
  const add = (key: string | null, label: string, id: string) => {
    if (!key) return;
    const bucket = byKey.get(key) ?? { label, ids: [] };
    if (!bucket.ids.includes(id)) bucket.ids.push(id);
    byKey.set(key, bucket);
  };
  for (const r of rows) {
    const id = r.id as string;
    if (entity === "contact") {
      const email = emailKey(r.email as string | null);
      if (email) add(`e:${email}`, email, id);
      for (const n of [r.phone, r.mobile, r.whatsapp]) {
        const key = phoneKey(n as string | null);
        if (key) add(`p:${key}`, String(n), id);
      }
      const name = `${text(r.firstName)} ${text(r.lastName)}`.toLowerCase().replace(/\s+/g, " ").trim();
      if (name && r.accountId) add(`n:${r.accountId}:${name}`, `the name ${text(r.firstName)} ${text(r.lastName)} at one account`, id);
    } else {
      const name = companyNameKey(r.name as string | null);
      if (name) add(`n:${name}`, `the name "${text(r.name)}"`, id);
      const domain = domainKey(r.website as string | null);
      if (domain) add(`w:${domain}`, domain, id);
      const tax = taxKey(r.taxNumberNtn as string | null);
      if (tax) add(`t:${tax}`, `tax number ${text(r.taxNumberNtn)}`, id);
      const phone = phoneKey(r.mainPhone as string | null);
      if (phone) add(`p:${phone}`, text(r.mainPhone), id);
    }
  }

  const groupsRaw: { label: string; ids: string[] }[] = [];
  const shown = new Set<string>();
  for (const bucket of byKey.values()) {
    if (bucket.ids.length < 2) continue;
    const signature = [...bucket.ids].sort().join("|");
    if (shown.has(signature)) continue;
    shown.add(signature);
    groupsRaw.push(bucket);
  }
  const involved = [...new Set(groupsRaw.flatMap((g) => g.ids))];
  const extras = await loadExtras(entity, involved);
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  return groupsRaw
    .map((g) => ({ matchedOn: g.label, records: g.ids.map((id) => toCandidate(entity, byId.get(id)!, extras)) }))
    .sort((a, b) => b.records.length - a.records.length);
}

export async function getMergeCandidates(entity: MergeEntity, ids: string[]): Promise<MergeCandidate[]> {
  await requirePermission(PERMISSIONS.ACCOUNT_READ);
  const db = await supabaseServer();
  const { data, error } = await db
    .from(tableOf(entity))
    .select(columnsOf(entity))
    .in("id", ids)
    .is("deletedAt", null)
    .order("createdAt", { ascending: true });
  if (error) throw new Error(`Could not load those records: ${error.message}`);
  const extras = await loadExtras(entity, ids);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => toCandidate(entity, r, extras));
}

const mergeSchema = z.object({
  entity: z.enum(["contact", "account"]),
  survivorId: z.string().uuid(),
  loserIds: z.array(z.string().uuid()).min(1, "Choose at least one duplicate to merge in."),
  values: z.record(z.string(), z.string()),
});

export async function mergeRecords(
  input: z.infer<typeof mergeSchema>,
): Promise<ActionResult<{ survivorId: string; mergedCount: number; recordsMoved: number }>> {
  const auth = await authorize(PERMISSIONS.ACCOUNT_WRITE);
  if (!auth.ok) return { ok: false, error: auth.error };
  const parsed = mergeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the merge." };
  const d = parsed.data;

  // The person must be able to see every record involved: the database function
  // runs with its own rights, so visibility is checked here, under theirs.
  const db = await supabaseServer();
  const all = [d.survivorId, ...d.loserIds];
  const { data: visible } = await db.from(tableOf(d.entity)).select("id").in("id", all).is("deletedAt", null);
  if ((visible ?? []).length !== all.length) return { ok: false, error: `One of those ${MERGE_NOUN[d.entity].many} is not available to you any more.` };

  const allowed = new Set(MERGE_FIELDS[d.entity].map((f) => f.key));
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(d.values)) if (allowed.has(key)) values[key] = value;

  const { data, error } = await db.rpc(d.entity === "contact" ? "merge_contacts" : "merge_accounts", {
    p_survivor: d.survivorId,
    p_losers: d.loserIds,
    p_values: values,
  });
  if (error) return { ok: false, error: error.message };

  const base = MERGE_NOUN[d.entity].path;
  revalidatePath(base);
  revalidatePath(`${base}/duplicates`);
  revalidatePath(`${base}/${d.survivorId}`);
  return { ok: true, data: data as { survivorId: string; mergedCount: number; recordsMoved: number } };
}
