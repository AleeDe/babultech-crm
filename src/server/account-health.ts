"use server";

import { requirePermission, PERMISSIONS } from "@/lib/authz";
import { supabaseServer } from "@/lib/supabase";
import {
  renewalRow, withinWindow, byUrgency, accountHealth, healthDisagrees,
  onboardingAge, type RenewalRow, type RenewalWindow, type HealthResult,
} from "@/lib/account-health";
import { one } from "@/lib/decimal";

const SCAN_LIMIT = 1000;
const today = () => new Date().toISOString().slice(0, 10);

type ContractRow = {
  id: string; contractNumber: string; name: string; accountId: string;
  endDate: string; renewalType: string | null; noticePeriodDays: number | null;
  contractValue: number; currencyCode: string;
  account: { name: string; ownerUserId: string | null; owner: { fullName: string; status: string } | null } | null;
};

/**
 * Contracts coming up for renewal, soonest first, with anything already lapsed
 * at the front. Renewal dates come from the contract's own end date - nothing
 * new is stored, so this reflects whatever the contracts currently say.
 */
export async function getRenewalQueue(window: RenewalWindow = 90) {
  await requirePermission(PERMISSIONS.OPPORTUNITY_READ);
  const db = await supabaseServer();
  const now = today();

  const { data, error } = await db
    .from("contract")
    .select(
      `id, contractNumber, name, accountId, endDate, renewalType, noticePeriodDays,
       contractValue, currencyCode,
       account:account!inner ( name, ownerUserId, owner:app_user!account_ownerUserId_fkey ( fullName, status ) )`,
    )
    // A terminated contract is not up for renewal; an expired one might still
    // need chasing, which is why it is not excluded here.
    .in("status", ["ACTIVE", "EXPIRED"])
    .is("deletedAt", null)
    .order("endDate", { ascending: true })
    .limit(SCAN_LIMIT);

  if (error) throw new Error("Could not load the renewal queue.");

  const accountOf = (raw: unknown) => {
    const account = one(raw as never) as
      { name: string; ownerUserId: string | null; owner: unknown } | null;
    const owner = account ? (one(account.owner as never) as { fullName: string; status: string } | null) : null;
    return {
      name: account?.name ?? "Unknown account",
      ownerUserId: account?.ownerUserId ?? null,
      // A former or deactivated owner is the same as no owner for the purpose
      // of knowing who will actually pick this up.
      ownerName: owner && owner.status === "ACTIVE" ? owner.fullName : null,
    };
  };

  const contractRows: RenewalRow[] = (data ?? []).map((raw) => {
    const contract = raw as unknown as ContractRow;
    return renewalRow(
      {
        source: "CONTRACT",
        id: contract.id, reference: contract.contractNumber, name: contract.name,
        accountId: contract.accountId, endDate: contract.endDate,
        renewalType: contract.renewalType, noticePeriodDays: contract.noticePeriodDays,
        value: Number(contract.contractValue ?? 0), currencyCode: contract.currencyCode,
      },
      accountOf(contract.account),
      now,
    );
  });

  const rows = contractRows;
  return {
    rows: byUrgency(withinWindow(rows, window)),
    scanned: rows.length,
    truncated: contractRows.length >= SCAN_LIMIT,
    window,
    today: now,
  };
}

export type AccountHealthRow = {
  accountId: string;
  accountName: string;
  ownerUserId: string | null;
  ownerName: string | null;
  customerStatus: string | null;
  storedHealth: string | null;
  derived: HealthResult;
  disagrees: boolean;
  onboarding: { days: number; overdue: boolean } | null;
};

/**
 * Health for the customer accounts the caller can see, worked out from the
 * records rather than read from the stored field. The stored value is kept and
 * shown beside it: this reports, it does not overwrite anyone's judgement.
 */
export async function getAccountHealth(): Promise<{
  rows: AccountHealthRow[]; scanned: number; truncated: boolean; today: string;
}> {
  await requirePermission(PERMISSIONS.ACCOUNT_READ);
  const db = await supabaseServer();
  const now = today();

  const { data: accounts, error } = await db
    .from("account")
    .select(`id, name, ownerUserId, customerStatus, customerHealth, createdAt,
             owner:app_user!account_ownerUserId_fkey ( fullName, status )`)
    .eq("accountType", "CUSTOMER")
    .is("deletedAt", null)
    .order("name")
    .limit(SCAN_LIMIT);

  if (error) throw new Error("Could not load accounts.");
  const ids = (accounts ?? []).map((a) => a.id as string);
  if (ids.length === 0) return { rows: [], scanned: 0, truncated: false, today: now };

  // Everything the score needs, in one round trip each rather than per account.
  const [invoices, cases, activities, contracts] = await Promise.all([
    db.from("invoice")
      .select("accountId, dueDate, outstandingAmount")
      .in("accountId", ids)
      .in("status", ["SENT", "PARTIALLY_PAID", "OVERDUE"])
      .is("deletedAt", null)
      .lt("dueDate", now)
      .gt("outstandingAmount", 0),
    db.from("support_case")
      .select("accountId, status, slaBreached, priority, reopenCount, satisfactionScore, closedAt")
      .in("accountId", ids)
      .is("deletedAt", null),
    db.from("activity")
      .select("relatedEntityId, completedAt, createdAt")
      .eq("relatedEntityType", "Account")
      .in("relatedEntityId", ids)
      .order("createdAt", { ascending: false }),
    db.from("contract")
      .select("accountId, endDate")
      .in("accountId", ids)
      .in("status", ["ACTIVE", "EXPIRED"])
      .is("deletedAt", null),
  ]);

  const byAccount = <T extends Record<string, unknown>>(rows: T[] | null, key: string) => {
    const map = new Map<string, T[]>();
    for (const row of rows ?? []) {
      const id = row[key] as string;
      if (!id) continue;
      const list = map.get(id);
      if (list) list.push(row); else map.set(id, [row]);
    }
    return map;
  };

  const invoicesBy = byAccount(invoices.data, "accountId");
  const casesBy = byAccount(cases.data, "accountId");
  const activitiesBy = byAccount(activities.data, "relatedEntityId");
  const contractsBy = byAccount(contracts.data, "accountId");

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const rows = (accounts ?? []).map((account) => {
    const id = account.id as string;
    const owner = one(account.owner as never) as { fullName: string; status: string } | null;
    const accountCases = casesBy.get(id) ?? [];
    const accountActivities = activitiesBy.get(id) ?? [];

    const latest = accountActivities
      .map((a) => (a.completedAt as string | null) ?? (a.createdAt as string))
      .sort()
      .at(-1) ?? null;

    const derived = accountHealth({
      overdueInvoices: (invoicesBy.get(id) ?? []).map((i) => ({
        dueDate: i.dueDate as string,
        outstandingAmount: Number(i.outstandingAmount ?? 0),
      })),
      openCases: accountCases
        .filter((c) => !["CLOSED", "RESOLVED", "CANCELLED"].includes(c.status as string))
        .map((c) => ({
          slaBreached: Boolean(c.slaBreached),
          priority: c.priority as string,
          reopenCount: Number(c.reopenCount ?? 0),
        })),
      recentSatisfaction: accountCases
        .filter((c) => c.satisfactionScore != null && (c.closedAt as string | null) && (c.closedAt as string) >= ninetyDaysAgo)
        .map((c) => Number(c.satisfactionScore)),
      lastActivityAt: latest,
      renewalDaysToEnd: (contractsBy.get(id) ?? []).map((c) =>
        Math.round((Date.parse(`${c.endDate as string}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86_400_000),
      ),
      today: now,
    });

    return {
      accountId: id,
      accountName: account.name as string,
      ownerUserId: (account.ownerUserId as string | null) ?? null,
      ownerName: owner && owner.status === "ACTIVE" ? owner.fullName : null,
      customerStatus: (account.customerStatus as string | null) ?? null,
      storedHealth: (account.customerHealth as string | null) ?? null,
      derived,
      disagrees: healthDisagrees(account.customerHealth as string | null, derived.status),
      onboarding: onboardingAge(account.customerStatus as string | null, account.createdAt as string, now),
    };
  });

  // Worst first: this is a queue, not an alphabetical list.
  rows.sort((a, b) => b.derived.score - a.derived.score || a.accountName.localeCompare(b.accountName));

  return { rows, scanned: rows.length, truncated: rows.length >= SCAN_LIMIT, today: now };
}
