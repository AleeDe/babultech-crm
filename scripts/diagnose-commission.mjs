// Why has this partner earned no commission?
//
// Commission failing to appear looks the same from outside whatever the
// cause: the deal closed and there is no record. This walks the chain in
// order - login, partner, the attribution link, the deals, the plans - and
// says which link is missing.
//
// Read-only. It changes nothing.
//
// Usage: node scripts/diagnose-commission.mjs someone@example.com
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
config({ path: ".env", quiet: true });

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const EMAIL = process.argv[2] ?? "shamsidev110@gmail.com";
const line = (s) => console.log(s);

line(`Tracing commission for ${EMAIL}\n${"=".repeat(60)}`);

// --- who is this? -----------------------------------------------------------
const { data: users } = await db
  .from("app_user")
  .select("id, fullName, email, userType, partnerId, contactId, status, deletedAt")
  .ilike("email", EMAIL);

line("\n1. LOGIN");
if (!users?.length) {
  line("   No app_user with that address at all.");
} else {
  for (const u of users) {
    line(`   ${u.fullName} — userType=${u.userType}, status=${u.status}`);
    line(`   partnerId=${u.partnerId ?? "none"}  contactId=${u.contactId ?? "none"}`);
    if (u.deletedAt) line("   DELETED");
  }
}

// --- partners in the system -------------------------------------------------
const { data: partners } = await db
  .from("partner")
  .select('id, partnerNumber, displayName, status, defaultCommissionPercent, withholdingTaxPercent, commissionPlanId, accountId, contactId, partnerManagerId')
  .is("deletedAt", null);

line(`\n2. PARTNERS IN THE SYSTEM (${partners?.length ?? 0})`);
for (const p of partners ?? []) {
  line(`   ${p.displayName} (${p.partnerNumber})`);
  line(`     status=${p.status}  defaultCommission=${p.defaultCommissionPercent ?? "not set"}%  withholding=${p.withholdingTaxPercent ?? "not set"}%`);
  line(`     plan=${p.commissionPlanId ?? "none"}  account=${p.accountId ?? "none"}`);
}

// Which partner, if any, does this login belong to?
const mine = (users ?? []).find((u) => u.partnerId);
const partner = mine ? (partners ?? []).find((p) => p.id === mine.partnerId) : null;

// --- the attribution link ---------------------------------------------------
line("\n3. DEALS THIS PARTNER IS ATTACHED TO");
if (!partner) {
  line("   Cannot check — this login is not linked to a partner record.");
} else {
  const { data: links } = await db
    .from("opportunity_partner")
    .select('id, opportunityId, role, revenueSharePercent, commissionPercentOverride, registeredAt, registrationExpiresAt, opportunity ( name, stage, amount, currencyCode, actualCloseDate )')
    .eq("partnerId", partner.id);

  if (!links?.length) {
    line("   NONE. No opportunity_partner row exists, so no commission can ever accrue.");
  } else {
    for (const l of links) {
      const o = l.opportunity;
      line(`   ${o?.name} — stage=${o?.stage}, amount=${o?.amount}`);
      line(`     share=${l.revenueSharePercent}%  override=${l.commissionPercentOverride ?? "none"}`);
      line(`     registered=${l.registeredAt ?? "never"}  expires=${l.registrationExpiresAt ?? "no expiry"}`);
    }
  }
}

// --- everything in the pipeline ---------------------------------------------
const { data: opps } = await db
  .from("opportunity")
  .select("id, name, stage, amount, actualCloseDate")
  .is("deletedAt", null);

line(`\n4. ALL OPPORTUNITIES (${opps?.length ?? 0})`);
for (const o of opps ?? []) line(`   ${o.name} — ${o.stage}, ${o.amount}`);

const { data: allLinks } = await db
  .from("opportunity_partner")
  .select("id, opportunityId, partnerId");
line(`\n5. ALL DEAL-PARTNER LINKS (${allLinks?.length ?? 0})`);

const { data: plans } = await db.from("commission_plan").select("id, name, trigger, rateType, flatPercent").is("deletedAt", null);
line(`\n6. COMMISSION PLANS (${plans?.length ?? 0})`);
for (const p of plans ?? []) line(`   ${p.name} — trigger=${p.trigger}, ${p.rateType} ${p.flatPercent ?? ""}`);

const { data: records } = await db
  .from("commission_record")
  .select("commissionNumber, partnerId, status, commissionAmount")
  .is("deletedAt", null);
line(`\n7. COMMISSION RECORDS (${records?.length ?? 0})`);
for (const r of records ?? []) line(`   ${r.commissionNumber} — ${r.status}, ${r.commissionAmount}`);

// --- the verdict ------------------------------------------------------------
line(`\n${"=".repeat(60)}\nVERDICT`);
if (!users?.length) {
  line("  That address has no login in the system.");
} else if (!mine) {
  line(`  This login is userType=${users[0].userType} and is NOT linked to a partner.`);
  line("  Commission attaches to a PARTNER record, not to a login, so nothing");
  line("  would accrue for them however many deals closed.");
} else if (!partner) {
  line("  The login names a partner that no longer exists.");
} else if (partner.status !== "ACTIVE") {
  line(`  The partnership is ${partner.status}. The engine skips anything not ACTIVE.`);
} else if (!(opps ?? []).length) {
  line("  There are no opportunities at all, so there is nothing to earn on.");
} else if (!(allLinks ?? []).length) {
  line("  No deal is attached to any partner, so no commission can accrue.");
}
