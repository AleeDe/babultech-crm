/**
 * Demo CRM data via supabase-js.
 *
 * seed-cloud.mjs seeds the identity data the app cannot start without — roles,
 * department, team, users, number sequences, currency. This builds the demo CRM
 * on top of it: accounts, contacts, products, leads, opportunities, quotations,
 * partners, commission, invoices, payments, cases and projects.
 *
 * Run seed-cloud.mjs FIRST — this reads the users and currencies it creates and
 * exits if they are missing.
 *
 * Idempotent: every write is an upsert keyed on a natural unique column, so
 * re-running updates the same rows rather than duplicating them.
 *
 * Run: node scripts/seed-demo.mjs
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

config({ path: ".env" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

// Service role: RLS is bypassed. Correct here — seeding is an admin operation
// that must write rows no user could see.
const db = createClient(url, key, { auth: { persistSession: false } });

function fail(label, error) {
  if (error) {
    console.error(`  x ${label}: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Prisma filled `id` and `updatedAt` client-side, so neither has a database
 * default. Going direct to PostgREST means supplying them here.
 */
async function upsert(table, rows, onConflict) {
  const now = new Date().toISOString();
  const withIds = rows.map((r) => ({ id: randomUUID(), updatedAt: now, ...r }));
  const { data, error } = await db.from(table).upsert(withIds, { onConflict }).select();
  fail(`${table} upsert`, error);
  return data;
}

/** Insert-if-absent for tables with no unique constraint to conflict on. */
async function ensureRow(table, match, row) {
  const { data: found, error: findErr } = await db
    .from(table)
    .select("*")
    .match(match)
    .limit(1);
  fail(`${table} lookup`, findErr);
  if (found?.length) return found[0];

  const { data, error } = await db
    .from(table)
    .insert({ id: randomUUID(), updatedAt: new Date().toISOString(), ...row })
    .select()
    .single();
  fail(`${table} insert`, error);
  return data;
}

/** Child rows are keyed on the parent, so replace them wholesale on re-run. */
async function replaceChildren(table, parentColumn, parentId, rows) {
  const { error: delErr } = await db.from(table).delete().eq(parentColumn, parentId);
  fail(`${table} clear`, delErr);
  if (!rows.length) return [];

  const now = new Date().toISOString();
  const { data, error } = await db
    .from(table)
    .insert(rows.map((r) => ({ id: randomUUID(), updatedAt: now, ...r })))
    .select();
  fail(`${table} insert`, error);
  return data;
}

const iso = (d) => d.toISOString();
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return iso(d);
};

console.log("\nSeeding demo CRM data...\n");

// -------------------------------------------------------- identity lookup
const { data: existingUsers, error: userErr } = await db
  .from("app_user")
  .select("id, email");
fail("app_user lookup", userErr);

const userId = Object.fromEntries((existingUsers ?? []).map((u) => [u.email, u.id]));

const required = [
  "admin@babultech.com",
  "sales.manager@babultech.com",
  "sales.exec@babultech.com",
  "finance@babultech.com",
];
const missing = required.filter((e) => !userId[e]);
if (missing.length) {
  console.error(`  x app_user is missing: ${missing.join(", ")}`);
  console.error("    Run `node scripts/seed-cloud.mjs` first.");
  process.exit(1);
}

const admin = userId["admin@babultech.com"];
const manager = userId["sales.manager@babultech.com"];
const exec = userId["sales.exec@babultech.com"];
const finance = userId["finance@babultech.com"];

// Delivery staff are optional: an older seed-cloud.mjs did not create them, and
// the demo should still run rather than fail on a missing key.
const pm = userId["pm@babultech.com"] ?? admin;
const consultant = userId["consultant@babultech.com"] ?? exec;

// ------------------------------------------------------------- tax rates
// tax_rate.name is not unique in the schema, so upsert's ON CONFLICT has no
// index to target. Look each row up by name and insert only when missing.
const taxRateSpecs = [
  { name: "GST 18%", ratePercent: 18, taxType: "SALES", effectiveFrom: day(-365), active: true },
  { name: "Services 15%", ratePercent: 15, taxType: "SALES", effectiveFrom: day(-365), active: true },
  { name: "WHT 10%", ratePercent: 10, taxType: "WITHHOLDING", effectiveFrom: day(-365), active: true },
];

const taxRates = [];
for (const spec of taxRateSpecs) {
  taxRates.push(await ensureRow("tax_rate", { name: spec.name }, spec));
}
const gst = taxRates.find((t) => t.name === "GST 18%");
console.log(`  ok tax_rate            ${taxRates.length}`);

// -------------------------------------------------------------- products
const products = await upsert(
  "product",
  [
    {
      productCode: "SW-ERP-001",
      name: "BabulTech ERP Suite",
      description: "Core ERP platform licence — finance, inventory and HR modules.",
      category: "Software",
      productType: "SUBSCRIPTION",
      billingType: "ANNUAL",
      unitOfMeasure: "Licence",
      standardPrice: 1850000,
      standardCost: 620000,
      defaultTaxRateId: gst.id,
      commissionPercent: 8,
      commissionable: true,
      active: true,
    },
    {
      productCode: "SW-CRM-002",
      name: "BabulTech CRM",
      description: "Sales, service and partner management platform.",
      category: "Software",
      productType: "SUBSCRIPTION",
      billingType: "ANNUAL",
      unitOfMeasure: "Licence",
      standardPrice: 950000,
      standardCost: 310000,
      defaultTaxRateId: gst.id,
      commissionPercent: 10,
      commissionable: true,
      active: true,
    },
    {
      productCode: "SV-IMPL-001",
      name: "Implementation Services",
      description: "Discovery, configuration, data migration and go-live support.",
      category: "Services",
      productType: "SERVICE",
      billingType: "MILESTONE",
      unitOfMeasure: "Project",
      standardPrice: 1250000,
      standardCost: 700000,
      defaultTaxRateId: gst.id,
      commissionPercent: 5,
      commissionable: true,
      active: true,
    },
    {
      productCode: "SV-CONS-002",
      name: "Consulting Day Rate",
      description: "Senior functional or technical consultant, per working day.",
      category: "Services",
      productType: "SERVICE",
      billingType: "HOURLY",
      unitOfMeasure: "Day",
      standardPrice: 65000,
      standardCost: 32000,
      defaultTaxRateId: gst.id,
      commissionPercent: 4,
      commissionable: true,
      active: true,
    },
    {
      productCode: "SV-SUPP-003",
      name: "Premium Support Retainer",
      description: "24x5 support with a four-hour response SLA.",
      category: "Support",
      productType: "SERVICE",
      billingType: "RETAINER",
      unitOfMeasure: "Month",
      standardPrice: 185000,
      standardCost: 74000,
      defaultTaxRateId: gst.id,
      commissionPercent: 6,
      commissionable: true,
      active: true,
    },
    {
      productCode: "HW-SRV-001",
      name: "On-Premise Server Bundle",
      description: "Rack server, licences and three-year hardware warranty.",
      category: "Hardware",
      productType: "PRODUCT",
      billingType: "FIXED",
      unitOfMeasure: "Unit",
      standardPrice: 2400000,
      standardCost: 1850000,
      defaultTaxRateId: gst.id,
      commissionPercent: 3,
      commissionable: true,
      active: true,
    },
    {
      productCode: "SV-TRN-004",
      name: "End-User Training",
      description: "Instructor-led training, up to twenty participants per batch.",
      category: "Services",
      productType: "SERVICE",
      billingType: "FIXED",
      unitOfMeasure: "Batch",
      standardPrice: 275000,
      standardCost: 120000,
      defaultTaxRateId: gst.id,
      commissionPercent: 5,
      commissionable: false,
      active: true,
    },
  ],
  "productCode",
);
const product = Object.fromEntries(products.map((p) => [p.productCode, p]));
console.log(`  ok product             ${products.length}`);

// -------------------------------------------------------------- accounts
const accounts = await upsert(
  "account",
  [
    {
      accountNumber: "ACC-2026-00001",
      name: "Sapphire Textiles Ltd",
      accountType: "CUSTOMER",
      customerStatus: "ACTIVE",
      ownerUserId: manager,
      industry: "Textile Manufacturing",
      website: "https://sapphiretextiles.com.pk",
      mainPhone: "+92 42 3577 1200",
      employeeCount: 4200,
      annualRevenue: 8500000000,
      taxNumberNtn: "1234567-8",
      billingAddress: { line1: "Plot 42, Sundar Industrial Estate", city: "Lahore", state: "Punjab", country: "Pakistan", postalCode: "54000" },
      creditLimit: 15000000,
      paymentTermsDays: 30,
      customerHealth: "GREEN",
      description: "Long-standing ERP customer. Expanding into a second manufacturing site.",
    },
    {
      accountNumber: "ACC-2026-00002",
      name: "Indus Pharma (Pvt) Ltd",
      accountType: "CUSTOMER",
      customerStatus: "ACTIVE",
      ownerUserId: exec,
      industry: "Pharmaceuticals",
      website: "https://induspharma.pk",
      mainPhone: "+92 21 3456 7890",
      employeeCount: 1800,
      annualRevenue: 3200000000,
      taxNumberNtn: "2345678-9",
      billingAddress: { line1: "F-12, SITE Industrial Area", city: "Karachi", state: "Sindh", country: "Pakistan", postalCode: "75700" },
      creditLimit: 8000000,
      paymentTermsDays: 45,
      customerHealth: "AMBER",
      description: "Regulatory compliance drives most requirements. Slow procurement cycle.",
    },
    {
      accountNumber: "ACC-2026-00003",
      name: "Karachi Logistics Group",
      accountType: "CUSTOMER",
      customerStatus: "ONBOARDING",
      ownerUserId: exec,
      industry: "Transport & Logistics",
      website: "https://klg.com.pk",
      mainPhone: "+92 21 3298 4455",
      employeeCount: 950,
      annualRevenue: 1750000000,
      taxNumberNtn: "3456789-0",
      billingAddress: { line1: "Warehouse 7, Port Qasim", city: "Karachi", state: "Sindh", country: "Pakistan", postalCode: "75020" },
      creditLimit: 5000000,
      paymentTermsDays: 30,
      customerHealth: "GREEN",
      description: "Signed in Q1. Implementation currently in the build phase.",
    },
    {
      accountNumber: "ACC-2026-00004",
      name: "Frontier Foods Pakistan",
      accountType: "PROSPECT",
      customerStatus: null,
      ownerUserId: manager,
      industry: "Food & Beverage",
      website: "https://frontierfoods.pk",
      mainPhone: "+92 91 5843 220",
      employeeCount: 620,
      annualRevenue: 890000000,
      billingAddress: { line1: "Industrial Estate, Hayatabad", city: "Peshawar", state: "KPK", country: "Pakistan", postalCode: "25000" },
      paymentTermsDays: 30,
      description: "Evaluating ERP vendors. Competing against a regional incumbent.",
    },
    {
      accountNumber: "ACC-2026-00005",
      name: "Meezan Retail Chain",
      accountType: "PROSPECT",
      customerStatus: null,
      ownerUserId: exec,
      industry: "Retail",
      website: "https://meezanretail.pk",
      mainPhone: "+92 51 2870 900",
      employeeCount: 2400,
      annualRevenue: 4100000000,
      billingAddress: { line1: "Blue Area, Jinnah Avenue", city: "Islamabad", state: "ICT", country: "Pakistan", postalCode: "44000" },
      paymentTermsDays: 30,
      description: "Multi-store POS and inventory consolidation project.",
    },
    {
      accountNumber: "ACC-2026-00006",
      name: "Gujranwala Steel Works",
      accountType: "CUSTOMER",
      customerStatus: "AT_RISK",
      ownerUserId: manager,
      industry: "Metals & Mining",
      mainPhone: "+92 55 3256 700",
      employeeCount: 780,
      annualRevenue: 1450000000,
      taxNumberNtn: "4567890-1",
      billingAddress: { line1: "GT Road, Industrial Zone", city: "Gujranwala", state: "Punjab", country: "Pakistan", postalCode: "52250" },
      creditLimit: 3000000,
      paymentTermsDays: 60,
      customerHealth: "RED",
      description: "Renewal at risk — two escalated support cases and an overdue invoice.",
    },
    {
      accountNumber: "ACC-2026-00007",
      name: "NexGen Systems",
      accountType: "PARTNER",
      customerStatus: null,
      ownerUserId: manager,
      industry: "IT Services",
      website: "https://nexgensystems.pk",
      mainPhone: "+92 42 3588 6600",
      employeeCount: 140,
      billingAddress: { line1: "Arfa Software Technology Park", city: "Lahore", state: "Punjab", country: "Pakistan", postalCode: "54600" },
      description: "Implementation partner covering central Punjab.",
    },
    {
      accountNumber: "ACC-2026-00008",
      name: "Horizon Cloud Distributors",
      accountType: "PARTNER",
      customerStatus: null,
      ownerUserId: manager,
      industry: "IT Distribution",
      website: "https://horizoncloud.ae",
      mainPhone: "+971 4 553 8800",
      employeeCount: 320,
      billingAddress: { line1: "Dubai Internet City, Building 14", city: "Dubai", country: "United Arab Emirates" },
      description: "Regional distributor for Gulf territory deals.",
    },
    {
      accountNumber: "ACC-2026-00009",
      name: "Sindh Business Advisors",
      accountType: "PARTNER",
      customerStatus: null,
      ownerUserId: exec,
      industry: "Business Consulting",
      mainPhone: "+92 21 3577 8899",
      employeeCount: 45,
      billingAddress: { line1: "Shahrah-e-Faisal, Office 302", city: "Karachi", state: "Sindh", country: "Pakistan", postalCode: "75350" },
      description: "Referral partner covering the Sindh region.",
    },
    {
      accountNumber: "ACC-2026-00010",
      name: "Peshawar Tech Resellers",
      accountType: "PARTNER",
      customerStatus: null,
      ownerUserId: manager,
      industry: "IT Reseller",
      mainPhone: "+92 91 5712 400",
      employeeCount: 28,
      billingAddress: { line1: "University Road", city: "Peshawar", state: "KPK", country: "Pakistan", postalCode: "25000" },
      description: "Reseller partner. Agreement currently lapsed.",
    },
  ],
  "accountNumber",
);
const account = Object.fromEntries(accounts.map((a) => [a.accountNumber, a]));
console.log(`  ok account             ${accounts.length}`);

// -------------------------------------------------------------- contacts
// Contact has no natural unique column, so match on account + email.
const contactSpecs = [
  { accountNumber: "ACC-2026-00001", firstName: "Imran", lastName: "Sheikh", jobTitle: "Chief Financial Officer", department: "Finance", email: "imran.sheikh@sapphiretextiles.com.pk", phone: "+92 42 3577 1210", mobile: "+92 300 8451200", isPrimary: true, preferredChannel: "EMAIL", communicationConsent: true },
  { accountNumber: "ACC-2026-00001", firstName: "Nadia", lastName: "Baig", jobTitle: "Head of IT", department: "Technology", email: "nadia.baig@sapphiretextiles.com.pk", mobile: "+92 321 4478899", isPrimary: false, preferredChannel: "WHATSAPP", communicationConsent: true },
  { accountNumber: "ACC-2026-00002", firstName: "Dr. Faisal", lastName: "Qureshi", jobTitle: "Director Operations", department: "Operations", email: "faisal.qureshi@induspharma.pk", phone: "+92 21 3456 7891", mobile: "+92 333 2201144", isPrimary: true, preferredChannel: "PHONE", communicationConsent: true },
  { accountNumber: "ACC-2026-00003", firstName: "Zainab", lastName: "Ali", jobTitle: "General Manager", department: "Operations", email: "zainab.ali@klg.com.pk", mobile: "+92 345 2119900", isPrimary: true, preferredChannel: "EMAIL", communicationConsent: true },
  { accountNumber: "ACC-2026-00004", firstName: "Yousaf", lastName: "Khattak", jobTitle: "Managing Director", email: "yousaf@frontierfoods.pk", mobile: "+92 300 5566778", isPrimary: true, preferredChannel: "PHONE", communicationConsent: false },
  { accountNumber: "ACC-2026-00005", firstName: "Rabia", lastName: "Noor", jobTitle: "Head of Retail Technology", department: "Technology", email: "rabia.noor@meezanretail.pk", mobile: "+92 312 7788990", isPrimary: true, preferredChannel: "EMAIL", communicationConsent: true },
  { accountNumber: "ACC-2026-00006", firstName: "Tariq", lastName: "Mehmood", jobTitle: "Plant Manager", email: "tariq.mehmood@gsw.com.pk", phone: "+92 55 3256 705", isPrimary: true, preferredChannel: "PHONE", communicationConsent: true },
  { accountNumber: "ACC-2026-00007", firstName: "Salman", lastName: "Raza", jobTitle: "Partner Alliance Lead", email: "salman.raza@nexgensystems.pk", mobile: "+92 301 8899001", isPrimary: true, preferredChannel: "EMAIL", communicationConsent: true },
  { accountNumber: "ACC-2026-00008", firstName: "Omar", lastName: "Al Marzooqi", jobTitle: "Regional Channel Director", email: "omar@horizoncloud.ae", mobile: "+971 50 448 2200", isPrimary: true, preferredChannel: "EMAIL", communicationConsent: true },
  // No account: an INDIVIDUAL partner links to a contact, and partner_identity_check
  // forbids carrying an account at the same time.
  { accountNumber: null, firstName: "Rehan", lastName: "Aslam", jobTitle: "Independent Consultant", email: "rehan.aslam@outlook.com", mobile: "+92 300 1122334", isPrimary: false, preferredChannel: "PHONE", communicationConsent: true },
];

const contacts = [];
for (const { accountNumber, ...spec } of contactSpecs) {
  const row = await ensureRow(
    "contact",
    { email: spec.email },
    { accountId: accountNumber ? account[accountNumber].id : null, active: true, ...spec },
  );
  contacts.push(row);
}
const contact = Object.fromEntries(contacts.map((c) => [c.email, c]));
console.log(`  ok contact             ${contacts.length}`);

// ----------------------------------------------------------------- leads
const leads = await upsert(
  "lead",
  [
    { leadNumber: "LEAD-2026-00001", firstName: "Adnan", lastName: "Rasheed", companyName: "Lahore Packaging Co", jobTitle: "Operations Head", email: "adnan@lhrpackaging.pk", phone: "+92 42 3599 1100", industry: "Packaging", leadSource: "Website", ownerUserId: exec, status: "NEW", rating: "WARM", estimatedValue: 1400000, description: "Downloaded the ERP buyer's guide and requested a callback.", nextFollowUpAt: at(2) },
    { leadNumber: "LEAD-2026-00002", firstName: "Hina", lastName: "Malik", companyName: "Multan Agro Foods", jobTitle: "Finance Manager", email: "hina.malik@multanagro.pk", phone: "+92 302 4455661", whatsapp: "+92 302 4455661", industry: "Agriculture", leadSource: "Trade Show", ownerUserId: exec, status: "CONTACTED", rating: "HOT", estimatedValue: 2600000, description: "Met at the Food Tech expo. Budget approved for this financial year.", nextFollowUpAt: at(1) },
    { leadNumber: "LEAD-2026-00003", firstName: "Kamran", lastName: "Zafar", companyName: "Sialkot Sports Exports", jobTitle: "Director", email: "kamran@sialkotsports.pk", whatsapp: "+92 321 9988776", industry: "Manufacturing", leadSource: "Partner Referral", ownerUserId: manager, status: "QUALIFIED", rating: "HOT", estimatedValue: 3100000, description: "Referred by NexGen Systems. Needs export documentation workflows.", nextFollowUpAt: at(3) },
    { leadNumber: "LEAD-2026-00004", firstName: "Sadia", lastName: "Hameed", companyName: "Islamabad Medical Centre", jobTitle: "Administrator", email: "sadia@imc.org.pk", phone: "+92 51 2298 400", industry: "Healthcare", leadSource: "Google Ads", ownerUserId: exec, status: "ATTEMPTED_CONTACT", rating: "COLD", estimatedValue: 750000, description: "Two calls unanswered. Trying email next.", nextFollowUpAt: at(5) },
    { leadNumber: "LEAD-2026-00005", firstName: "Bilal", lastName: "Chaudhry", companyName: "Faisalabad Looms", jobTitle: "CEO", email: "bilal@fsdlooms.pk", phone: "+92 300 7712233", industry: "Textile Manufacturing", leadSource: "Cold Outreach", ownerUserId: manager, status: "NURTURING", rating: "WARM", estimatedValue: 1900000, description: "Interested but deferred to next budget cycle.", nextFollowUpAt: at(45) },
    { leadNumber: "LEAD-2026-00006", firstName: "Nasir", lastName: "Iqbal", companyName: "Quetta Traders", jobTitle: "Owner", email: "nasir@quettatraders.pk", industry: "Wholesale", leadSource: "Website", ownerUserId: exec, status: "DISQUALIFIED", rating: "COLD", estimatedValue: 200000, disqualifiedReason: "Team of four — below our minimum viable deal size." },
    { leadNumber: "LEAD-2026-00007", firstName: "Ayesha", lastName: "Siddiqui", companyName: "Hyderabad Ceramics", jobTitle: "Procurement Lead", email: "ayesha@hydceramics.pk", phone: "+92 333 8877665", whatsapp: "+92 333 8877665", industry: "Manufacturing", leadSource: "LinkedIn", ownerUserId: exec, status: "DISCOVERY_SCHEDULED", rating: "WARM", estimatedValue: 1650000, description: "Discovery workshop booked for next week.", nextFollowUpAt: at(7) },
    { leadNumber: "LEAD-2026-00008", firstName: "Junaid", lastName: "Akram", companyName: "Rawalpindi Auto Parts", jobTitle: "General Manager", email: "junaid@rwpauto.pk", phone: "+92 51 5566 220", industry: "Automotive", leadSource: "Referral", ownerUserId: manager, status: "ASSIGNED", rating: "WARM", estimatedValue: 1200000, description: "Referred by an existing customer. Not yet contacted.", nextFollowUpAt: at(4) },
  ],
  "leadNumber",
);
console.log(`  ok lead                ${leads.length}`);

// --------------------------------------------------------- opportunities
const opportunities = await upsert(
  "opportunity",
  [
    { opportunityNumber: "OPP-2026-00001", name: "Sapphire Textiles — Second Site ERP Rollout", accountId: account["ACC-2026-00001"].id, primaryContactId: contact["imran.sheikh@sapphiretextiles.com.pk"].id, ownerUserId: manager, stage: "NEGOTIATION", amount: 4850000, currencyCode: "PKR", probabilityPercent: 75, expectedCloseDate: day(21), opportunityType: "UPSELL", leadSource: "Existing Customer", nextStep: "Finalise payment terms with the CFO.", description: "Extend the ERP licence to the new Sheikhupura plant plus implementation." },
    { opportunityNumber: "OPP-2026-00002", name: "Indus Pharma — Compliance Module", accountId: account["ACC-2026-00002"].id, primaryContactId: contact["faisal.qureshi@induspharma.pk"].id, ownerUserId: exec, stage: "QUOTE_SUBMITTED", amount: 2350000, currencyCode: "PKR", probabilityPercent: 60, expectedCloseDate: day(35), opportunityType: "UPSELL", leadSource: "Account Review", nextStep: "Chase quotation feedback after the board meeting.", description: "DRAP compliance reporting and batch traceability." },
    { opportunityNumber: "OPP-2026-00003", name: "Karachi Logistics — CRM & Support Retainer", accountId: account["ACC-2026-00003"].id, primaryContactId: contact["zainab.ali@klg.com.pk"].id, ownerUserId: exec, stage: "CLOSED_WON", amount: 3275000, currencyCode: "PKR", probabilityPercent: 100, expectedCloseDate: day(-40), actualCloseDate: day(-38), opportunityType: "NEW", leadSource: "Partner Referral", description: "CRM licences, implementation and a twelve-month support retainer." },
    { opportunityNumber: "OPP-2026-00004", name: "Frontier Foods — ERP Platform Selection", accountId: account["ACC-2026-00004"].id, primaryContactId: contact["yousaf@frontierfoods.pk"].id, ownerUserId: manager, stage: "REQUIREMENTS", amount: 3600000, currencyCode: "PKR", probabilityPercent: 35, expectedCloseDate: day(70), opportunityType: "NEW", leadSource: "Trade Show", nextStep: "Submit the requirements traceability matrix.", description: "Competitive evaluation against a regional incumbent.", competitorName: "OrionSoft Regional" },
    { opportunityNumber: "OPP-2026-00005", name: "Meezan Retail — Multi-Store POS Consolidation", accountId: account["ACC-2026-00005"].id, primaryContactId: contact["rabia.noor@meezanretail.pk"].id, ownerUserId: exec, stage: "DISCOVERY", amount: 5200000, currencyCode: "PKR", probabilityPercent: 15, expectedCloseDate: day(95), opportunityType: "NEW", leadSource: "Outbound", nextStep: "Run discovery across three pilot stores.", description: "Consolidate 40+ stores onto one inventory and POS platform." },
    { opportunityNumber: "OPP-2026-00006", name: "Gujranwala Steel — Annual Renewal", accountId: account["ACC-2026-00006"].id, primaryContactId: contact["tariq.mehmood@gsw.com.pk"].id, ownerUserId: manager, stage: "ON_HOLD", amount: 1150000, currencyCode: "PKR", probabilityPercent: 30, expectedCloseDate: day(30), opportunityType: "RENEWAL", leadSource: "Renewal", nextStep: "Resolve the open escalations before reopening commercials.", description: "Renewal blocked by service quality concerns." },
    { opportunityNumber: "OPP-2026-00007", name: "Sapphire Textiles — Training Programme", accountId: account["ACC-2026-00001"].id, primaryContactId: contact["nadia.baig@sapphiretextiles.com.pk"].id, ownerUserId: exec, stage: "CLOSED_LOST", amount: 550000, currencyCode: "PKR", probabilityPercent: 0, expectedCloseDate: day(-15), actualCloseDate: day(-12), opportunityType: "CROSS_SELL", leadSource: "Existing Customer", lossReason: "Customer chose to run training with their internal L&D team.", description: "Four training batches for the finance and stores teams." },
    { opportunityNumber: "OPP-2026-00008", name: "Indus Pharma — Server Refresh", accountId: account["ACC-2026-00002"].id, primaryContactId: contact["faisal.qureshi@induspharma.pk"].id, ownerUserId: manager, stage: "SOLUTION_PROPOSED", amount: 2400000, currencyCode: "PKR", probabilityPercent: 45, expectedCloseDate: day(55), opportunityType: "CROSS_SELL", leadSource: "Account Review", nextStep: "Present the hardware sizing study.", description: "On-premise server bundle to replace end-of-life hardware." },
  ],
  "opportunityNumber",
);
const opp = Object.fromEntries(opportunities.map((o) => [o.opportunityNumber, o]));
console.log(`  ok opportunity         ${opportunities.length}`);

// ------------------------------------------------- opportunity products
const oppProductRows = [
  ["OPP-2026-00001", "SW-ERP-001", 2, 1850000],
  ["OPP-2026-00001", "SV-IMPL-001", 1, 1150000],
  ["OPP-2026-00002", "SW-ERP-001", 1, 1850000],
  ["OPP-2026-00002", "SV-CONS-002", 8, 62500],
  ["OPP-2026-00003", "SW-CRM-002", 2, 950000],
  ["OPP-2026-00003", "SV-IMPL-001", 1, 1150000],
  ["OPP-2026-00003", "SV-SUPP-003", 12, 18750],
  ["OPP-2026-00004", "SW-ERP-001", 1, 1850000],
  ["OPP-2026-00004", "SV-IMPL-001", 1, 1250000],
  ["OPP-2026-00005", "SW-ERP-001", 2, 1850000],
  ["OPP-2026-00005", "SV-IMPL-001", 1, 1250000],
  ["OPP-2026-00006", "SW-ERP-001", 1, 1150000],
  ["OPP-2026-00008", "HW-SRV-001", 1, 2400000],
];

for (const number of Object.keys(opp)) {
  const rows = oppProductRows
    .filter(([oppNum]) => oppNum === number)
    .map(([, code, quantity, unitPrice], i) => ({
      opportunityId: opp[number].id,
      productId: product[code].id,
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
      sortOrder: i,
    }));
  await replaceChildren("opportunity_product", "opportunityId", opp[number].id, rows);
}
console.log(`  ok opportunity_product ${oppProductRows.length}`);

// ------------------------------------------------------------- partners
const partners = await upsert(
  "partner",
  [
    {
      partnerNumber: "PTR-2026-00001",
      displayName: "NexGen Systems",
      kind: "COMPANY",
      accountId: account["ACC-2026-00007"].id,
      partnerType: "IMPLEMENTATION",
      tier: "GOLD",
      status: "ACTIVE",
      partnerManagerId: manager,
      territory: "Central Punjab",
      startDate: day(-540),
      agreementExpiryDate: day(190),
      defaultCommissionPercent: 12,
      payoutCurrencyCode: "PKR",
      taxNumber: "5678901-2",
      withholdingTaxPercent: 10,
      registrationProtectionDays: 90,
      email: "alliances@nexgensystems.pk",
      phone: "+92 42 3588 6600",
      website: "https://nexgensystems.pk",
      notes: "Strongest delivery partner. Certified on both ERP and CRM.",
    },
    {
      partnerNumber: "PTR-2026-00002",
      displayName: "Horizon Cloud Distributors",
      kind: "COMPANY",
      accountId: account["ACC-2026-00008"].id,
      partnerType: "DISTRIBUTOR",
      tier: "PLATINUM",
      status: "ACTIVE",
      partnerManagerId: manager,
      territory: "Gulf Region",
      startDate: day(-820),
      agreementExpiryDate: day(410),
      defaultCommissionPercent: 15,
      payoutCurrencyCode: "USD",
      withholdingTaxPercent: 0,
      registrationProtectionDays: 120,
      email: "channel@horizoncloud.ae",
      phone: "+971 4 553 8800",
      website: "https://horizoncloud.ae",
      notes: "Handles all UAE and Saudi opportunities. Invoices in USD.",
    },
    {
      partnerNumber: "PTR-2026-00003",
      displayName: "Sindh Business Advisors",
      kind: "COMPANY",
      accountId: account["ACC-2026-00009"].id,
      partnerType: "REFERRAL",
      tier: "SILVER",
      status: "ACTIVE",
      partnerManagerId: exec,
      territory: "Sindh",
      startDate: day(-260),
      agreementExpiryDate: day(105),
      defaultCommissionPercent: 7,
      payoutCurrencyCode: "PKR",
      withholdingTaxPercent: 10,
      registrationProtectionDays: 60,
      email: "referrals@sindhadvisors.pk",
      phone: "+92 21 3577 8899",
      notes: "Referral-only. Introduced Karachi Logistics Group.",
    },
    {
      partnerNumber: "PTR-2026-00004",
      displayName: "Rehan Aslam",
      kind: "INDIVIDUAL",
      contactId: contact["rehan.aslam@outlook.com"].id,
      partnerType: "REFERRAL",
      tier: "REGISTERED",
      status: "PROSPECTIVE",
      partnerManagerId: exec,
      territory: "Islamabad",
      startDate: day(-40),
      defaultCommissionPercent: 5,
      payoutCurrencyCode: "PKR",
      withholdingTaxPercent: 10,
      email: "rehan.aslam@outlook.com",
      phone: "+92 300 1122334",
      notes: "Independent consultant. Agreement still under review.",
    },
    {
      partnerNumber: "PTR-2026-00005",
      displayName: "Peshawar Tech Resellers",
      kind: "COMPANY",
      accountId: account["ACC-2026-00010"].id,
      partnerType: "RESELLER",
      tier: "REGISTERED",
      status: "INACTIVE",
      partnerManagerId: manager,
      territory: "KPK",
      startDate: day(-700),
      agreementExpiryDate: day(-60),
      defaultCommissionPercent: 8,
      payoutCurrencyCode: "PKR",
      withholdingTaxPercent: 10,
      email: "info@pesbtech.pk",
      notes: "Agreement lapsed. No deals registered in the last two quarters.",
    },
  ],
  "partnerNumber",
);
const partner = Object.fromEntries(partners.map((p) => [p.partnerNumber, p]));
console.log(`  ok partner             ${partners.length}`);

// -------------------------------------------------- opportunity partners
// revenueSharePercent defaults to 100 and a trigger caps the per-opportunity
// total at 100, so every row states its share explicitly. Clearing the
// opportunity's existing rows first keeps re-runs from tripping that cap.
const oppPartnerRows = [
  { opportunityId: opp["OPP-2026-00003"].id, partnerId: partner["PTR-2026-00003"].id, role: "SOURCED", revenueSharePercent: 100, commissionPercentOverride: 7, registeredAt: at(-70), registrationExpiresAt: at(-10), notes: "Introduced the account and stayed involved through discovery." },
  { opportunityId: opp["OPP-2026-00001"].id, partnerId: partner["PTR-2026-00001"].id, role: "DELIVERED", revenueSharePercent: 100, commissionPercentOverride: 12, registeredAt: at(-45), registrationExpiresAt: at(45) },
  { opportunityId: opp["OPP-2026-00004"].id, partnerId: partner["PTR-2026-00001"].id, role: "INFLUENCED", revenueSharePercent: 60, commissionPercentOverride: 12, registeredAt: at(-20), registrationExpiresAt: at(70) },
  { opportunityId: opp["OPP-2026-00005"].id, partnerId: partner["PTR-2026-00002"].id, role: "RESOLD", revenueSharePercent: 100, commissionPercentOverride: 15, registeredAt: at(-15), registrationExpiresAt: at(105) },
];

// commission_record references opportunity_partner, so its demo rows go first
// or the delete below hits a foreign key.
{
  const { error } = await db
    .from("commission_record")
    .delete()
    .in("commissionNumber", ["COM-2026-00001", "COM-2026-00002"]);
  fail("commission_record clear", error);
}

const oppPartners = [];
for (const oppId of new Set(oppPartnerRows.map((r) => r.opportunityId))) {
  const rows = oppPartnerRows.filter((r) => r.opportunityId === oppId);
  oppPartners.push(...(await replaceChildren("opportunity_partner", "opportunityId", oppId, rows)));
}
console.log(`  ok opportunity_partner ${oppPartners.length}`);

// ------------------------------------------------------ commission plan
const plan = await ensureRow(
  "commission_plan",
  { name: "Standard Partner Plan 2026" },
  {
    name: "Standard Partner Plan 2026",
    description: "Flat commission on collected amount, settled monthly.",
    basis: "COLLECTED_AMOUNT",
    trigger: "ON_PAYMENT_RECEIVED",
    rateType: "FLAT_PERCENT",
    flatPercent: 7,
    minimumDealAmount: 250000,
    payoutDelayDays: 15,
    clawbackWindowDays: 90,
    effectiveFrom: day(-365),
    active: true,
  },
);
console.log("  ok commission_plan     1");

// ------------------------------------------------------------ quotations
const quotations = await upsert(
  "quotation",
  [
    { quoteNumber: "QUO-2026-00001", opportunityId: opp["OPP-2026-00001"].id, accountId: account["ACC-2026-00001"].id, contactId: contact["imran.sheikh@sapphiretextiles.com.pk"].id, versionNumber: 1, status: "SENT", quoteDate: day(-14), expiryDate: day(16), currencyCode: "PKR", subtotal: 4850000, discountAmount: 200000, taxAmount: 837000, totalAmount: 5487000, paymentTerms: "50% on signing, 50% on go-live.", notes: "Pricing held for thirty days from the quote date.", approvalStatus: "APPROVED", sentAt: at(-13) },
    { quoteNumber: "QUO-2026-00002", opportunityId: opp["OPP-2026-00002"].id, accountId: account["ACC-2026-00002"].id, contactId: contact["faisal.qureshi@induspharma.pk"].id, versionNumber: 1, status: "SENT", quoteDate: day(-9), expiryDate: day(21), currencyCode: "PKR", subtotal: 2350000, discountAmount: 0, taxAmount: 423000, totalAmount: 2773000, paymentTerms: "45 days from invoice date.", approvalStatus: "APPROVED", sentAt: at(-8) },
    { quoteNumber: "QUO-2026-00003", opportunityId: opp["OPP-2026-00003"].id, accountId: account["ACC-2026-00003"].id, contactId: contact["zainab.ali@klg.com.pk"].id, versionNumber: 1, status: "ACCEPTED", quoteDate: day(-52), expiryDate: day(-22), currencyCode: "PKR", subtotal: 3275000, discountAmount: 125000, taxAmount: 567000, totalAmount: 3717000, paymentTerms: "40% advance, 30% at UAT, 30% at go-live.", approvalStatus: "APPROVED", sentAt: at(-51), acceptedAt: at(-40) },
    { quoteNumber: "QUO-2026-00004", opportunityId: opp["OPP-2026-00004"].id, accountId: account["ACC-2026-00004"].id, contactId: contact["yousaf@frontierfoods.pk"].id, versionNumber: 1, status: "DRAFT", quoteDate: day(-2), expiryDate: day(28), currencyCode: "PKR", subtotal: 3100000, discountAmount: 0, taxAmount: 558000, totalAmount: 3658000, paymentTerms: "To be agreed.", notes: "Awaiting the final scope confirmation before sending.", approvalStatus: "PENDING" },
    { quoteNumber: "QUO-2026-00005", opportunityId: opp["OPP-2026-00008"].id, accountId: account["ACC-2026-00002"].id, contactId: contact["faisal.qureshi@induspharma.pk"].id, versionNumber: 1, status: "UNDER_REVIEW", quoteDate: day(-4), expiryDate: day(26), currencyCode: "PKR", subtotal: 2400000, discountAmount: 100000, taxAmount: 414000, totalAmount: 2714000, paymentTerms: "100% on delivery and installation.", approvalStatus: "PENDING" },
  ],
  "quoteNumber",
);
const quote = Object.fromEntries(quotations.map((q) => [q.quoteNumber, q]));
console.log(`  ok quotation           ${quotations.length}`);

// ------------------------------------------------------------ quote lines
const quoteLineRows = [
  ["QUO-2026-00001", "SW-ERP-001", "BabulTech ERP Suite — Sheikhupura site licence (2 sites)", 2, 1850000, 0],
  ["QUO-2026-00001", "SV-IMPL-001", "Implementation, migration and go-live support", 1, 1150000, 0],
  ["QUO-2026-00002", "SW-ERP-001", "Compliance and batch traceability module", 1, 1850000, 0],
  ["QUO-2026-00002", "SV-CONS-002", "Regulatory configuration consulting (8 days)", 8, 62500, 0],
  ["QUO-2026-00003", "SW-CRM-002", "BabulTech CRM — 2 site licences", 2, 950000, 0],
  ["QUO-2026-00003", "SV-IMPL-001", "CRM implementation and data migration", 1, 1150000, 0],
  ["QUO-2026-00003", "SV-SUPP-003", "Premium support retainer (12 months)", 12, 18750, 0],
  ["QUO-2026-00004", "SW-ERP-001", "BabulTech ERP Suite — single site licence", 1, 1850000, 0],
  ["QUO-2026-00004", "SV-IMPL-001", "Implementation services", 1, 1250000, 0],
  ["QUO-2026-00005", "HW-SRV-001", "On-premise server bundle with 3-year warranty", 1, 2400000, 0],
];

for (const number of Object.keys(quote)) {
  const rows = quoteLineRows
    .filter(([q]) => q === number)
    .map(([, code, description, quantity, unitPrice, discountPercent], i) => ({
      quotationId: quote[number].id,
      productId: product[code].id,
      description,
      quantity,
      unitPrice,
      discountPercent,
      taxRateId: gst.id,
      lineTotal: quantity * unitPrice,
      sortOrder: i,
    }));
  await replaceChildren("quote_line", "quotationId", quote[number].id, rows);
}
console.log(`  ok quote_line          ${quoteLineRows.length}`);

// -------------------------------------------------------------- invoices
const invoices = await upsert(
  "invoice",
  [
    { invoiceNumber: "INV-2026-00001", accountId: account["ACC-2026-00003"].id, contactId: contact["zainab.ali@klg.com.pk"].id, invoiceDate: day(-38), dueDate: day(-8), status: "PAID", currencyCode: "PKR", subtotal: 1260000, discountAmount: 0, taxAmount: 226800, totalAmount: 1486800, paidAmount: 1486800, outstandingAmount: 0, paymentTermsDays: 30, notes: "Advance instalment — 40% of contract value.", sentAt: at(-37) },
    { invoiceNumber: "INV-2026-00002", accountId: account["ACC-2026-00003"].id, contactId: contact["zainab.ali@klg.com.pk"].id, invoiceDate: day(-12), dueDate: day(18), status: "PARTIALLY_PAID", currencyCode: "PKR", subtotal: 945000, discountAmount: 0, taxAmount: 170100, totalAmount: 1115100, paidAmount: 500000, outstandingAmount: 615100, paymentTermsDays: 30, notes: "UAT milestone instalment — 30% of contract value.", sentAt: at(-11) },
    { invoiceNumber: "INV-2026-00003", accountId: account["ACC-2026-00001"].id, contactId: contact["imran.sheikh@sapphiretextiles.com.pk"].id, invoiceDate: day(-25), dueDate: day(5), status: "SENT", currencyCode: "PKR", subtotal: 2220000, discountAmount: 0, taxAmount: 399600, totalAmount: 2619600, paidAmount: 0, outstandingAmount: 2619600, paymentTermsDays: 30, notes: "Annual ERP subscription renewal.", sentAt: at(-24) },
    { invoiceNumber: "INV-2026-00004", accountId: account["ACC-2026-00006"].id, contactId: contact["tariq.mehmood@gsw.com.pk"].id, invoiceDate: day(-95), dueDate: day(-35), status: "OVERDUE", currencyCode: "PKR", subtotal: 1150000, discountAmount: 0, taxAmount: 207000, totalAmount: 1357000, paidAmount: 0, outstandingAmount: 1357000, paymentTermsDays: 60, notes: "Support retainer. Payment overdue — escalated to finance.", sentAt: at(-94) },
    { invoiceNumber: "INV-2026-00005", accountId: account["ACC-2026-00002"].id, contactId: contact["faisal.qureshi@induspharma.pk"].id, invoiceDate: day(-6), dueDate: day(39), status: "APPROVED", currencyCode: "PKR", subtotal: 555000, discountAmount: 0, taxAmount: 99900, totalAmount: 654900, paidAmount: 0, outstandingAmount: 654900, paymentTermsDays: 45, notes: "Consulting days delivered in the current quarter." },
    { invoiceNumber: "INV-2026-00006", accountId: account["ACC-2026-00001"].id, contactId: contact["nadia.baig@sapphiretextiles.com.pk"].id, invoiceDate: day(-1), dueDate: day(29), status: "DRAFT", currencyCode: "PKR", subtotal: 185000, discountAmount: 0, taxAmount: 33300, totalAmount: 218300, paidAmount: 0, outstandingAmount: 218300, paymentTermsDays: 30, notes: "Monthly support retainer — pending review." },
  ],
  "invoiceNumber",
);
const invoice = Object.fromEntries(invoices.map((i) => [i.invoiceNumber, i]));
console.log(`  ok invoice             ${invoices.length}`);

// ---------------------------------------------------------- invoice lines
const invoiceLineRows = [
  ["INV-2026-00001", "SW-CRM-002", "CRM licences — advance instalment", 1, 1260000],
  ["INV-2026-00002", "SV-IMPL-001", "Implementation — UAT milestone", 1, 945000],
  ["INV-2026-00003", "SW-ERP-001", "ERP Suite — annual subscription renewal", 1, 1850000],
  ["INV-2026-00003", "SV-SUPP-003", "Premium support retainer (2 months)", 2, 185000],
  ["INV-2026-00004", "SV-SUPP-003", "Support retainer arrears", 1, 1150000],
  ["INV-2026-00005", "SV-CONS-002", "Consulting days delivered", 8, 69375],
  ["INV-2026-00006", "SV-SUPP-003", "Premium support retainer — current month", 1, 185000],
];

for (const number of Object.keys(invoice)) {
  const rows = invoiceLineRows
    .filter(([inv]) => inv === number)
    .map(([, code, description, quantity, unitPrice], i) => ({
      invoiceId: invoice[number].id,
      productId: product[code].id,
      description,
      quantity,
      unitPrice,
      taxRateId: gst.id,
      lineTotal: quantity * unitPrice,
      sortOrder: i,
    }));
  await replaceChildren("invoice_line", "invoiceId", invoice[number].id, rows);
}
console.log(`  ok invoice_line        ${invoiceLineRows.length}`);

// -------------------------------------------------------------- payments
const payments = await upsert(
  "payment",
  [
    { paymentNumber: "PAY-2026-00001", accountId: account["ACC-2026-00003"].id, paymentDate: day(-30), amount: 1486800, unallocatedAmount: 0, currencyCode: "PKR", paymentMethod: "BANK", status: "CLEARED", clearedAt: at(-29), referenceNumber: "TRF-884512", notes: "Advance instalment received in full." },
    { paymentNumber: "PAY-2026-00002", accountId: account["ACC-2026-00003"].id, paymentDate: day(-4), amount: 500000, unallocatedAmount: 0, currencyCode: "PKR", paymentMethod: "BANK", status: "CLEARED", clearedAt: at(-3), referenceNumber: "TRF-901337", notes: "Part payment against the UAT milestone invoice." },
    { paymentNumber: "PAY-2026-00003", accountId: account["ACC-2026-00002"].id, paymentDate: day(-2), amount: 250000, unallocatedAmount: 250000, currencyCode: "PKR", paymentMethod: "CHEQUE", status: "PENDING", referenceNumber: "CHQ-220981", notes: "Cheque deposited — awaiting clearance. Not yet allocated." },
  ],
  "paymentNumber",
);
const payment = Object.fromEntries(payments.map((p) => [p.paymentNumber, p]));
console.log(`  ok payment             ${payments.length}`);

// --------------------------------------------------- payment allocations
// payment_allocation has no updatedAt column, so it bypasses the upsert()
// helper's id/updatedAt injection. A trigger also caps the total allocated
// against a payment, and it counts the rows already there — so on a re-run the
// old rows must go before the new ones land, not merely be conflicted onto.
{
  const paymentIds = [payment["PAY-2026-00001"].id, payment["PAY-2026-00002"].id];
  const { error: delErr } = await db
    .from("payment_allocation")
    .delete()
    .in("paymentId", paymentIds);
  fail("payment_allocation clear", delErr);

  const { error } = await db.from("payment_allocation").insert([
    { id: randomUUID(), paymentId: payment["PAY-2026-00001"].id, invoiceId: invoice["INV-2026-00001"].id, allocatedAmount: 1486800, allocatedAt: at(-30), allocatedById: finance },
    { id: randomUUID(), paymentId: payment["PAY-2026-00002"].id, invoiceId: invoice["INV-2026-00002"].id, allocatedAmount: 500000, allocatedAt: at(-4), allocatedById: finance },
  ]);
  fail("payment_allocation insert", error);
}
console.log("  ok payment_allocation  2");

// ---------------------------------------------------- commission records
const referrerLink = oppPartners.find(
  (r) => r.opportunityId === opp["OPP-2026-00003"].id && r.partnerId === partner["PTR-2026-00003"].id,
);

const commissions = await upsert(
  "commission_record",
  [
    {
      commissionNumber: "COM-2026-00001",
      partnerId: partner["PTR-2026-00003"].id,
      opportunityId: opp["OPP-2026-00003"].id,
      opportunityPartnerId: referrerLink.id,
      planId: plan.id,
      invoiceId: invoice["INV-2026-00001"].id,
      paymentId: payment["PAY-2026-00001"].id,
      basis: "COLLECTED_AMOUNT",
      basisAmount: 1486800,
      ratePercent: 7,
      commissionAmount: 104076,
      withholdingTaxAmount: 10408,
      netPayableAmount: 93668,
      currencyCode: "PKR",
      status: "APPROVED",
      earnedDate: day(-30),
      payableFromDate: day(-15),
      approvedById: finance,
      approvedAt: at(-14),
      calculationNotes: "Referral commission on the collected advance instalment.",
    },
    {
      commissionNumber: "COM-2026-00002",
      partnerId: partner["PTR-2026-00003"].id,
      opportunityId: opp["OPP-2026-00003"].id,
      opportunityPartnerId: referrerLink.id,
      planId: plan.id,
      invoiceId: invoice["INV-2026-00002"].id,
      paymentId: payment["PAY-2026-00002"].id,
      basis: "COLLECTED_AMOUNT",
      basisAmount: 500000,
      ratePercent: 7,
      commissionAmount: 35000,
      withholdingTaxAmount: 3500,
      netPayableAmount: 31500,
      currencyCode: "PKR",
      status: "ACCRUED",
      earnedDate: day(-4),
      calculationNotes: "Accrued on the part payment against the UAT milestone.",
    },
  ],
  "commissionNumber",
);
console.log(`  ok commission_record   ${commissions.length}`);

// ------------------------------------------------------- service level data
//
// cases.ts stamps every case with the active policy for its priority. Without
// these rows that lookup finds nothing and cases are created with no deadline
// — the SLA engine runs and decides nothing.
const officeHours = await ensureRow(
  "business_hours",
  { name: "Pakistan office hours" },
  {
    name: "Pakistan office hours",
    timezone: "Asia/Karachi",
    weeklySchedule: {
      monday: { start: "09:00", end: "18:00" },
      tuesday: { start: "09:00", end: "18:00" },
      wednesday: { start: "09:00", end: "18:00" },
      thursday: { start: "09:00", end: "18:00" },
      friday: { start: "09:00", end: "13:00" },
      saturday: null,
      sunday: null,
    },
    isDefault: true,
    active: true,
  },
);
console.log("  ok business_hours      1");

// Critical runs round the clock: a production outage does not wait for Monday.
// The rest follow office hours, which is what the customer actually experiences.
const slaPolicies = [];
for (const spec of [
  { name: "Critical — 1h response, 8h fix", priority: "CRITICAL", firstResponseMinutes: 60, resolutionMinutes: 480, businessHoursId: null, pauseOnCustomerWait: true, active: true },
  { name: "High — 4h response, 2 working days", priority: "HIGH", firstResponseMinutes: 240, resolutionMinutes: 2880, businessHoursId: officeHours.id, pauseOnCustomerWait: true, active: true },
  { name: "Medium — 1 working day, 5 days", priority: "MEDIUM", firstResponseMinutes: 480, resolutionMinutes: 7200, businessHoursId: officeHours.id, pauseOnCustomerWait: true, active: true },
  { name: "Low — 2 working days, 10 days", priority: "LOW", firstResponseMinutes: 960, resolutionMinutes: 14400, businessHoursId: officeHours.id, pauseOnCustomerWait: true, active: true },
]) {
  slaPolicies.push(await ensureRow("sla_policy", { name: spec.name }, spec));
}
console.log(`  ok sla_policy          ${slaPolicies.length}`);


// ---------------------------------------------------------- support cases
const caseCategory = await ensureRow(
  "case_category",
  { name: "Application Defect" },
  { name: "Application Defect", active: true },
);

const cases = await upsert(
  "support_case",
  [
    { caseNumber: "CASE-2026-00001", subject: "Stock valuation report shows negative quantities", description: "After the month-end close, the valuation report lists three SKUs with negative on-hand quantities. Suspected to be a timing issue between the goods receipt and the invoice posting.", accountId: account["ACC-2026-00006"].id, contactId: contact["tariq.mehmood@gsw.com.pk"].id, categoryId: caseCategory.id, caseType: "PROBLEM", status: "IN_PROGRESS", priority: "CRITICAL", source: "EMAIL", ownerUserId: pm },
    { caseNumber: "CASE-2026-00002", subject: "Cannot generate the batch traceability export", description: "The export runs for several minutes and then fails without an error message. Reproducible on batches with more than 500 line items.", accountId: account["ACC-2026-00002"].id, contactId: contact["faisal.qureshi@induspharma.pk"].id, categoryId: caseCategory.id, caseType: "INCIDENT", status: "WAITING_FOR_CUSTOMER", priority: "HIGH", source: "PORTAL", ownerUserId: admin },
    { caseNumber: "CASE-2026-00003", subject: "Request: add a warehouse to the receiving workflow", description: "The new Sheikhupura warehouse needs adding to the goods receipt dropdown and the stock transfer routes.", accountId: account["ACC-2026-00001"].id, contactId: contact["nadia.baig@sapphiretextiles.com.pk"].id, caseType: "REQUEST", status: "NEW", priority: "MEDIUM", source: "EMAIL", ownerUserId: consultant },
    { caseNumber: "CASE-2026-00004", subject: "How do I schedule a recurring invoice?", description: "Customer asked whether the CRM can raise the support retainer invoice automatically each month.", accountId: account["ACC-2026-00003"].id, contactId: contact["zainab.ali@klg.com.pk"].id, caseType: "QUESTION", status: "RESOLVED", priority: "LOW", source: "WHATSAPP", ownerUserId: consultant, resolution: "Walked the customer through the recurring invoice template. No product change needed.", resolvedAt: at(-3), satisfactionScore: 5 },
    { caseNumber: "CASE-2026-00005", subject: "Login fails for three finance users", description: "Three finance team members receive an invalid credentials error despite a successful password reset.", accountId: account["ACC-2026-00006"].id, contactId: contact["tariq.mehmood@gsw.com.pk"].id, categoryId: caseCategory.id, caseType: "INCIDENT", status: "ASSIGNED", priority: "HIGH", source: "PHONE", ownerUserId: pm },
    { caseNumber: "CASE-2026-00006", subject: "Dashboard totals differ from the ledger", description: "The revenue tile on the finance dashboard reads about 4% lower than the general ledger for the same period.", accountId: account["ACC-2026-00001"].id, contactId: contact["imran.sheikh@sapphiretextiles.com.pk"].id, categoryId: caseCategory.id, caseType: "PROBLEM", status: "CLOSED", priority: "MEDIUM", source: "EMAIL", ownerUserId: admin, rootCause: "Currency rounding applied at display time rather than at conversion.", resolution: "Corrected the multi-currency rounding order. Fixed in release 4.2.1.", resolvedAt: at(-20), closedAt: at(-18), satisfactionScore: 4 },
  ],
  "caseNumber",
);
console.log(`  ok support_case        ${cases.length}`);

// Stamp the SLA deadlines the app would have set at creation time. Without
// these the cases exist but nothing is ever due, so the breach tile and the
// overdue colouring on the case list have nothing to work with.
{
  const policyFor = Object.fromEntries(slaPolicies.map((p) => [p.priority, p]));
  const now = new Date().toISOString();

  const stamped = cases
    .filter((c) => policyFor[c.priority])
    .map((c) => {
      const policy = policyFor[c.priority];
      const raised = new Date(c.createdAt).getTime();
      const open = !["RESOLVED", "CLOSED", "CANCELLED"].includes(c.status);
      const resolutionDue = new Date(raised + policy.resolutionMinutes * 60_000);

      return {
        id: c.id,
        updatedAt: now,
        slaPolicyId: policy.id,
        firstResponseDueAt: new Date(raised + policy.firstResponseMinutes * 60_000).toISOString(),
        resolutionDueAt: resolutionDue.toISOString(),
        // Breached only where the clock has actually run out on an open case.
        slaBreached: open && resolutionDue.getTime() < Date.now(),
      };
    });

  // One update per case rather than an upsert: upsert treats a partial row as
  // an insert and trips the NOT NULL on caseNumber.
  for (const row of stamped) {
    const { id, ...values } = row;
    const { error } = await db.from("support_case").update(values).eq("id", id);
    fail("support_case SLA stamp", error);
  }
  console.log(`  ok case SLA deadlines  ${stamped.length}`);
}

// --------------------------------------------------- case conversations
//
// A case with no thread is a title and a status. These give the screens
// something to show and exercise the SLA pause path.
const commentRows = [
  { caseNumber: "CASE-2026-00001", commentType: "CUSTOMER_COMMENT", body: "Three SKUs are showing negative on-hand after the month-end close. Purchasing cannot raise orders against them.", isPublic: true, authorUserId: null, minutes: null },
  { caseNumber: "CASE-2026-00001", commentType: "AGENT_RESPONSE", body: "Thank you for reporting this. We are reproducing it now against your month-end snapshot and will come back within the hour.", isPublic: true, authorUserId: pm, minutes: 15 },
  { caseNumber: "CASE-2026-00001", commentType: "INTERNAL_NOTE", body: "Reproduced. Goods receipt posts before the invoice, so valuation reads the quantity mid-transaction. Needs a fix in the posting order, not a data correction.", isPublic: false, authorUserId: pm, minutes: 45 },
  { caseNumber: "CASE-2026-00002", commentType: "CUSTOMER_COMMENT", body: "The batch traceability export fails silently on anything over 500 lines.", isPublic: true, authorUserId: null, minutes: null },
  { caseNumber: "CASE-2026-00002", commentType: "AGENT_RESPONSE", body: "We can see the timeout in the logs. Could you confirm which batch numbers you tried, so we can test against the same volume?", isPublic: true, authorUserId: pm, minutes: 20 },
  { caseNumber: "CASE-2026-00004", commentType: "AGENT_RESPONSE", body: "Walked through the recurring invoice template on a call. No product change needed — the feature was already there under Contracts.", isPublic: true, authorUserId: consultant, minutes: 30 },
];

{
  const caseByNumber = Object.fromEntries(cases.map((c) => [c.caseNumber, c]));
  const caseIds = cases.map((c) => c.id);

  const { error: delErr } = await db.from("case_comment").delete().in("caseId", caseIds);
  fail("case_comment clear", delErr);

  const now = new Date().toISOString();
  const { error } = await db.from("case_comment").insert(
    commentRows.map((r, i) => ({
      id: randomUUID(),
      updatedAt: now,
      caseId: caseByNumber[r.caseNumber].id,
      authorUserId: r.authorUserId,
      authorContactId: null,
      commentType: r.commentType,
      body: r.body,
      isPublic: r.isPublic,
      timeSpentMinutes: r.minutes,
      // Spread across the last few days so the thread reads in order.
      createdAt: at(-3 + i * 0.3),
    })),
  );
  fail("case_comment insert", error);
}
console.log(`  ok case_comment        ${commentRows.length}`);

// CASE-2026-00002 is waiting on the customer, so its clock is paused. Without
// the events the pause is invisible and the deadline reads as still running.
{
  const waiting = cases.find((c) => c.caseNumber === "CASE-2026-00002");
  if (waiting) {
    const { error: delErr } = await db.from("sla_timer_event").delete().eq("caseId", waiting.id);
    fail("sla_timer_event clear", delErr);

    const { error } = await db.from("sla_timer_event").insert([
      { id: randomUUID(), caseId: waiting.id, eventType: "STARTED", eventAt: at(-3), reason: "Case raised", createdById: pm },
      { id: randomUUID(), caseId: waiting.id, eventType: "PAUSED", eventAt: at(-2), reason: "Waiting on the customer", createdById: pm },
    ]);
    fail("sla_timer_event insert", error);
    console.log("  ok sla_timer_event     2");
  }
}

// -------------------------------------------------------------- projects
const projects = await upsert(
  "project",
  [
    { projectNumber: "PRJ-2026-00001", name: "Karachi Logistics — CRM Implementation", accountId: account["ACC-2026-00003"].id, projectManagerId: pm, opportunityId: opp["OPP-2026-00003"].id, status: "ACTIVE", billingType: "MILESTONE", startDate: day(-35), plannedEndDate: day(55), currencyCode: "PKR", contractValue: 3275000, approvedHours: 1200, completionPercent: 45, scope: "Full CRM rollout with data migration from two legacy systems.", health: "GREEN" },
    { projectNumber: "PRJ-2026-00002", name: "Sapphire Textiles — Second Site Rollout", accountId: account["ACC-2026-00001"].id, projectManagerId: pm, status: "PLANNING", billingType: "MILESTONE", startDate: day(14), plannedEndDate: day(140), currencyCode: "PKR", contractValue: 4850000, approvedHours: 1800, completionPercent: 0, scope: "ERP extension to the Sheikhupura plant. Awaiting contract signature.", health: "GREEN" },
    { projectNumber: "PRJ-2026-00003", name: "Indus Pharma — Compliance Module Build", accountId: account["ACC-2026-00002"].id, projectManagerId: admin, status: "AT_RISK", billingType: "FIXED", startDate: day(-70), plannedEndDate: day(10), currencyCode: "PKR", contractValue: 1850000, approvedHours: 640, completionPercent: 70, scope: "DRAP reporting build. Slipping on the customer-side data readiness.", health: "AMBER" },
  ],
  "projectNumber",
);
const project = Object.fromEntries(projects.map((p) => [p.projectNumber, p]));
console.log(`  ok project             ${projects.length}`);

// ------------------------------------------------------- project members
await upsert(
  "project_member",
  [
    { projectId: project["PRJ-2026-00001"].id, userId: pm, projectRole: "Project Manager", allocationPercent: 50, billingRate: 8500, costRate: 4200, active: true },
    { projectId: project["PRJ-2026-00001"].id, userId: consultant, projectRole: "Functional Consultant", allocationPercent: 80, billingRate: 6500, costRate: 3100, active: true },
    { projectId: project["PRJ-2026-00002"].id, userId: pm, projectRole: "Project Manager", allocationPercent: 30, billingRate: 8500, costRate: 4200, active: true },
    { projectId: project["PRJ-2026-00003"].id, userId: admin, projectRole: "Project Manager", allocationPercent: 40, billingRate: 9000, costRate: 4500, active: true },
    { projectId: project["PRJ-2026-00003"].id, userId: consultant, projectRole: "Technical Lead", allocationPercent: 60, billingRate: 7200, costRate: 3600, active: true },
  ],
  "projectId,userId",
);
console.log("  ok project_member      5");

// ------------------------------------------------- payables reference data
const expenseCategories = [];
for (const spec of [
  { name: "Travel", glCode: "6100", requiresReceipt: true, active: true },
  { name: "Accommodation", glCode: "6110", requiresReceipt: true, active: true },
  { name: "Subcontractor", glCode: "6200", requiresReceipt: true, active: true },
  { name: "Software & Licences", glCode: "6300", requiresReceipt: true, active: true },
  { name: "Office & Supplies", glCode: "6400", requiresReceipt: false, active: true },
  { name: "Client Entertainment", glCode: "6500", requiresReceipt: true, active: true },
]) {
  expenseCategories.push(await ensureRow("expense_category", { name: spec.name }, spec));
}
const expenseCategory = Object.fromEntries(expenseCategories.map((c) => [c.name, c]));
console.log(`  ok expense_category    ${expenseCategories.length}`);

const bankAccounts = [];
for (const spec of [
  { name: "HBL Current — Operations", accountType: "BANK", bankName: "Habib Bank Limited", accountNumberMasked: "****1234", currencyCode: "PKR", openingBalance: 4500000, active: true },
  { name: "Meezan USD Account", accountType: "BANK", bankName: "Meezan Bank", accountNumberMasked: "****4567", currencyCode: "USD", openingBalance: 25000, active: true },
  { name: "Petty Cash", accountType: "CASH", currencyCode: "PKR", openingBalance: 50000, active: true },
]) {
  bankAccounts.push(await ensureRow("bank_account", { name: spec.name }, spec));
}
const bankAccount = Object.fromEntries(bankAccounts.map((b) => [b.name, b]));
console.log(`  ok bank_account        ${bankAccounts.length}`);

// -------------------------------------------------------------- campaigns
const campaignTypes = [];
for (const spec of [
  { name: "Trade Show", channel: "Event", active: true },
  { name: "Email Campaign", channel: "Email", active: true },
  { name: "Paid Search", channel: "Digital", active: true },
  { name: "Partner Co-Marketing", channel: "Partner", active: true },
]) {
  campaignTypes.push(await ensureRow("campaign_type", { name: spec.name }, spec));
}
const campaignType = Object.fromEntries(campaignTypes.map((c) => [c.name, c]));
console.log(`  ok campaign_type       ${campaignTypes.length}`);

const campaigns = await upsert(
  "campaign",
  [
    { campaignNumber: "CAM-2026-00001", name: "Food Tech Expo 2026", campaignTypeId: campaignType["Trade Show"].id, ownerUserId: manager, status: "COMPLETED", description: "Stand and speaking slot at the Karachi food technology expo.", startDate: day(-75), endDate: day(-70), budgetAmount: 850000, actualCost: 910000, expectedLeads: 40, expectedRevenue: 6000000 },
    { campaignNumber: "CAM-2026-00002", name: "Manufacturing ERP — Q3 Email Series", campaignTypeId: campaignType["Email Campaign"].id, ownerUserId: exec, status: "ACTIVE", description: "Six-part nurture sequence to the manufacturing list.", startDate: day(-20), endDate: day(40), budgetAmount: 180000, actualCost: 62000, expectedLeads: 120, expectedRevenue: 4500000 },
    { campaignNumber: "CAM-2026-00003", name: "Google Ads — ERP Pakistan", campaignTypeId: campaignType["Paid Search"].id, ownerUserId: exec, status: "ACTIVE", description: "Search campaign on ERP and inventory keywords.", startDate: day(-60), endDate: day(30), budgetAmount: 600000, actualCost: 412000, expectedLeads: 90, expectedRevenue: 3200000 },
    { campaignNumber: "CAM-2026-00004", name: "NexGen Joint Webinar", campaignTypeId: campaignType["Partner Co-Marketing"].id, ownerUserId: manager, status: "PLANNED", description: "Co-hosted webinar with NexGen Systems on export compliance.", startDate: day(18), endDate: day(18), budgetAmount: 220000, actualCost: 0, expectedLeads: 60, expectedRevenue: 2800000 },
    { campaignNumber: "CAM-2026-00005", name: "Retail Sector Outreach", campaignTypeId: campaignType["Email Campaign"].id, ownerUserId: exec, status: "PAUSED", description: "Paused pending new sector collateral.", startDate: day(-45), endDate: day(15), budgetAmount: 150000, actualCost: 38000, expectedLeads: 50, expectedRevenue: 1900000 },
  ],
  "campaignNumber",
);
console.log(`  ok campaign            ${campaigns.length}`);

// -------------------------------------------------------------- contracts
const contracts = await upsert(
  "contract",
  [
    { contractNumber: "CTR-2026-00001", name: "Karachi Logistics — CRM Licence & Services", accountId: account["ACC-2026-00003"].id, opportunityId: opp["OPP-2026-00003"].id, quotationId: quote["QUO-2026-00003"].id, ownerUserId: exec, contractType: "Licence & Services", status: "ACTIVE", startDate: day(-38), endDate: day(327), contractValue: 3717000, currencyCode: "PKR", billingFrequency: "MILESTONE", renewalType: "MANUAL", noticePeriodDays: 60, signedDate: day(-38) },
    { contractNumber: "CTR-2026-00002", name: "Sapphire Textiles — ERP Subscription", accountId: account["ACC-2026-00001"].id, ownerUserId: manager, contractType: "Subscription", status: "ACTIVE", startDate: day(-300), endDate: day(65), contractValue: 2619600, currencyCode: "PKR", billingFrequency: "ANNUAL", renewalType: "AUTO_RENEW", noticePeriodDays: 90, signedDate: day(-300) },
    { contractNumber: "CTR-2026-00003", name: "Gujranwala Steel — Support Retainer", accountId: account["ACC-2026-00006"].id, ownerUserId: manager, contractType: "Support Retainer", status: "EXPIRED", startDate: day(-430), endDate: day(-65), contractValue: 1357000, currencyCode: "PKR", billingFrequency: "MONTHLY", renewalType: "MANUAL", noticePeriodDays: 30, signedDate: day(-430), terminationReason: "Lapsed while service escalations were unresolved." },
    { contractNumber: "CTR-2026-00004", name: "Sapphire Textiles — Second Site Extension", accountId: account["ACC-2026-00001"].id, opportunityId: opp["OPP-2026-00001"].id, quotationId: quote["QUO-2026-00001"].id, ownerUserId: manager, contractType: "Licence & Services", status: "SENT_FOR_SIGNATURE", startDate: day(14), endDate: day(379), contractValue: 5487000, currencyCode: "PKR", billingFrequency: "MILESTONE", renewalType: "MANUAL", noticePeriodDays: 60 },
    { contractNumber: "CTR-2026-00005", name: "Indus Pharma — Compliance Module", accountId: account["ACC-2026-00002"].id, ownerUserId: admin, contractType: "Fixed Price", status: "DRAFT", startDate: day(7), endDate: day(190), contractValue: 1850000, currencyCode: "PKR", billingFrequency: "MILESTONE", renewalType: "MANUAL" },
  ],
  "contractNumber",
);
console.log(`  ok contract            ${contracts.length}`);

// ---------------------------------------------------- project breakdown
const phaseRows = [
  { projectId: project["PRJ-2026-00001"].id, name: "Discovery & Design", sequenceNumber: 1, ownerUserId: manager, plannedStart: day(-35), plannedEnd: day(-15), actualStart: day(-35), actualEnd: day(-14), status: "COMPLETED", completionPercent: 100, budgetedHours: 240 },
  { projectId: project["PRJ-2026-00001"].id, name: "Build & Configuration", sequenceNumber: 2, ownerUserId: exec, plannedStart: day(-14), plannedEnd: day(20), actualStart: day(-14), status: "ACTIVE", completionPercent: 55, budgetedHours: 560 },
  { projectId: project["PRJ-2026-00001"].id, name: "UAT & Go-Live", sequenceNumber: 3, ownerUserId: manager, plannedStart: day(21), plannedEnd: day(55), status: "NOT_STARTED", completionPercent: 0, budgetedHours: 400 },
  { projectId: project["PRJ-2026-00003"].id, name: "Requirements", sequenceNumber: 1, ownerUserId: admin, plannedStart: day(-70), plannedEnd: day(-45), actualStart: day(-70), actualEnd: day(-40), status: "COMPLETED", completionPercent: 100, budgetedHours: 160 },
  { projectId: project["PRJ-2026-00003"].id, name: "Build", sequenceNumber: 2, ownerUserId: exec, plannedStart: day(-40), plannedEnd: day(5), actualStart: day(-38), status: "ACTIVE", completionPercent: 70, budgetedHours: 320 },
];

const phases = [];
for (const projId of new Set(phaseRows.map((r) => r.projectId))) {
  phases.push(
    ...(await replaceChildren(
      "project_phase",
      "projectId",
      projId,
      phaseRows.filter((r) => r.projectId === projId),
    )),
  );
}
const phase = Object.fromEntries(phases.map((p) => [`${p.projectId}:${p.name}`, p]));
console.log(`  ok project_phase       ${phases.length}`);

const p1 = project["PRJ-2026-00001"].id;
const p3 = project["PRJ-2026-00003"].id;

const milestoneRows = [
  { projectId: p1, phaseId: phase[`${p1}:Discovery & Design`].id, name: "Design sign-off", ownerUserId: manager, dueDate: day(-15), completedDate: day(-14), status: "COMPLETED", customerApprovalRequired: true, customerApprovalDate: day(-14), billingPercent: 40, billingAmount: 1486800, invoicedAt: at(-38) },
  { projectId: p1, phaseId: phase[`${p1}:Build & Configuration`].id, name: "UAT entry", ownerUserId: exec, dueDate: day(20), status: "IN_PROGRESS", customerApprovalRequired: true, billingPercent: 30, billingAmount: 1115100 },
  { projectId: p1, phaseId: phase[`${p1}:UAT & Go-Live`].id, name: "Go-live", ownerUserId: manager, dueDate: day(55), status: "PLANNED", customerApprovalRequired: true, billingPercent: 30, billingAmount: 1115100 },
  { projectId: p3, phaseId: phase[`${p3}:Build`].id, name: "Compliance build complete", ownerUserId: admin, dueDate: day(5), status: "DELAYED", description: "Slipped: customer-side reference data still outstanding.", billingPercent: 100, billingAmount: 1850000 },
];

const milestones = [];
for (const projId of new Set(milestoneRows.map((r) => r.projectId))) {
  milestones.push(
    ...(await replaceChildren(
      "milestone",
      "projectId",
      projId,
      milestoneRows.filter((r) => r.projectId === projId),
    )),
  );
}
console.log(`  ok milestone           ${milestones.length}`);

const taskRows = [
  { projectId: p1, phaseId: phase[`${p1}:Build & Configuration`].id, name: "Migrate account and contact records", assignedUserId: consultant, status: "COMPLETED", priority: "HIGH", startDate: day(-14), dueDate: day(-6), completedDate: day(-7), estimatedHours: 40, completionPercent: 100, billable: true, sortOrder: 0 },
  { projectId: p1, phaseId: phase[`${p1}:Build & Configuration`].id, name: "Configure sales pipeline stages", assignedUserId: consultant, status: "IN_PROGRESS", priority: "MEDIUM", startDate: day(-6), dueDate: day(6), estimatedHours: 32, completionPercent: 60, billable: true, sortOrder: 1 },
  { projectId: p1, phaseId: phase[`${p1}:Build & Configuration`].id, name: "Build management dashboards", assignedUserId: pm, status: "NOT_STARTED", priority: "MEDIUM", startDate: day(6), dueDate: day(18), estimatedHours: 48, completionPercent: 0, billable: true, sortOrder: 2 },
  { projectId: p1, phaseId: phase[`${p1}:UAT & Go-Live`].id, name: "Write UAT scripts", assignedUserId: pm, status: "NOT_STARTED", priority: "HIGH", startDate: day(21), dueDate: day(30), estimatedHours: 24, completionPercent: 0, billable: true, sortOrder: 3 },
  { projectId: p3, phaseId: phase[`${p3}:Build`].id, name: "Batch traceability data model", assignedUserId: consultant, status: "COMPLETED", priority: "CRITICAL", startDate: day(-38), dueDate: day(-20), completedDate: day(-22), estimatedHours: 60, completionPercent: 100, billable: true, sortOrder: 0 },
  { projectId: p3, phaseId: phase[`${p3}:Build`].id, name: "DRAP reporting templates", assignedUserId: consultant, status: "BLOCKED", priority: "CRITICAL", startDate: day(-20), dueDate: day(2), estimatedHours: 80, completionPercent: 45, billable: true, acceptanceCriteria: "Blocked: awaiting the customer's reference data extract.", sortOrder: 1 },
];

const tasks = [];
for (const projId of new Set(taskRows.map((r) => r.projectId))) {
  tasks.push(
    ...(await replaceChildren(
      "project_task",
      "projectId",
      projId,
      taskRows.filter((r) => r.projectId === projId),
    )),
  );
}
const taskByName = Object.fromEntries(tasks.map((t) => [t.name, t]));
console.log(`  ok project_task        ${tasks.length}`);

// ------------------------------------------------------- risks and issues
//
// A risk might happen; an issue already has. riskScore is probability × impact
// on a 1–4 scale each, matching LEVEL_SCORE in src/server/projects.ts.
const riskRows = [
  { projectId: p1, title: "Legacy data quality is unknown", description: "Two source systems with no documented schema. If the extracts are dirty the migration slips.", probability: "MEDIUM", impact: "HIGH", riskScore: 6, mitigationPlan: "Profile both extracts in week one and agree a cleansing budget before build starts.", ownerUserId: pm, targetDate: day(10), status: "MONITORING" },
  { projectId: p1, title: "Key user availability over Eid", description: "The finance team is the main UAT group and will be on leave for part of the test window.", probability: "HIGH", impact: "MEDIUM", riskScore: 6, mitigationPlan: "Pull UAT forward by a week and record walkthroughs for anyone who misses them.", ownerUserId: consultant, targetDate: day(25), status: "OPEN" },
  { projectId: p3, title: "DRAP reference data not supplied", description: "The build cannot be validated without the regulator's current product register.", probability: "CRITICAL", impact: "CRITICAL", riskScore: 16, mitigationPlan: "Escalated to the customer's director of operations. Weekly follow-up until received.", ownerUserId: admin, targetDate: day(3), status: "OPEN" },
  { projectId: p3, title: "Single developer on the compliance module", description: "One person holds all the domain knowledge for the batch traceability work.", probability: "MEDIUM", impact: "HIGH", riskScore: 6, mitigationPlan: "Pair a second developer in from next sprint and write the design down.", ownerUserId: pm, targetDate: day(14), status: "MITIGATED" },
];

for (const projId of new Set(riskRows.map((r) => r.projectId))) {
  await replaceChildren(
    "project_risk",
    "projectId",
    projId,
    riskRows.filter((r) => r.projectId === projId),
  );
}
console.log(`  ok project_risk        ${riskRows.length}`);

const issueRows = [
  { projectId: p1, title: "Contact import dropped 340 records", description: "Rows without an email address were silently skipped by the first import pass.", severity: "HIGH", ownerUserId: consultant, resolutionPlan: "Re-run with email made optional and reconcile counts against the source.", dueDate: day(4), status: "IN_PROGRESS" },
  { projectId: p1, title: "Stage names do not match the customer's process", description: "The customer uses a seven-stage pipeline; the default configuration has six.", severity: "MEDIUM", ownerUserId: consultant, resolutionPlan: "Agreed to add the extra stage. Configuration change, no code.", dueDate: day(-2), status: "RESOLVED", resolvedAt: at(-2) },
  { projectId: p3, title: "Report templates blocked pending data", description: "Template work cannot proceed without the reference register — see the linked risk.", severity: "CRITICAL", ownerUserId: exec, resolutionPlan: "Blocked. Developer reassigned to the Karachi build until the data arrives.", dueDate: day(2), status: "OPEN" },
];

for (const projId of new Set(issueRows.map((r) => r.projectId))) {
  await replaceChildren(
    "project_issue",
    "projectId",
    projId,
    issueRows.filter((r) => r.projectId === projId),
  );
}
console.log(`  ok project_issue       ${issueRows.length}`);

// ------------------------------------------------------- change requests
const changeRequests = await upsert(
  "change_request",
  [
    { requestNumber: "CR-2026-00001", projectId: p1, title: "Add a seventh pipeline stage", description: "Customer's sales process has a formal 'legal review' step between negotiation and close.", businessReason: "Their deals cannot be tracked accurately without it.", scopeImpact: "Configuration only — one extra stage and its probability default.", costImpact: 0, scheduleImpactDays: 0, approvalStatus: "APPROVED", status: "IMPLEMENTED" },
    { requestNumber: "CR-2026-00002", projectId: p1, title: "WhatsApp notifications for case updates", description: "Send the customer a WhatsApp message whenever a support case changes status.", businessReason: "Their customers do not read email reliably.", scopeImpact: "New integration, outside the agreed scope. Needs a provider account and template approval.", costImpact: 450000, scheduleImpactDays: 15, approvalStatus: "PENDING", status: "ASSESSED" },
    { requestNumber: "CR-2026-00003", projectId: p3, title: "Additional regulatory report format", description: "A second export layout for the provincial regulator alongside the DRAP one.", businessReason: "Required by Sindh health authority from next quarter.", scopeImpact: "One more report template and its mapping.", costImpact: 185000, scheduleImpactDays: 7, approvalStatus: "PENDING", status: "REQUESTED" },
  ],
  "requestNumber",
);
console.log(`  ok change_request      ${changeRequests.length}`);

// ------------------------------------------------------------- time logs
const timeLogRows = [
  { userId: consultant, projectId: p1, projectTaskId: taskByName["Migrate account and contact records"].id, workDate: day(-12), hours: 7.5, description: "Mapped legacy account fields and ran the first import pass.", billable: true, billingRate: 6500, costRate: 3100, approvalStatus: "APPROVED", approvedById: pm, approvedAt: at(-10) },
  { userId: consultant, projectId: p1, projectTaskId: taskByName["Migrate account and contact records"].id, workDate: day(-11), hours: 8, description: "Contact deduplication and second import pass.", billable: true, billingRate: 6500, costRate: 3100, approvalStatus: "APPROVED", approvedById: pm, approvedAt: at(-10) },
  { userId: consultant, projectId: p1, projectTaskId: taskByName["Configure sales pipeline stages"].id, workDate: day(-4), hours: 6, description: "Configured stages and probability defaults with the customer.", billable: true, billingRate: 6500, costRate: 3100, approvalStatus: "SUBMITTED" },
  { userId: consultant, projectId: p1, projectTaskId: taskByName["Configure sales pipeline stages"].id, workDate: day(-1), hours: 5.5, description: "Stage transition rules and validation.", billable: true, billingRate: 6500, costRate: 3100, approvalStatus: "DRAFT" },
  { userId: pm, projectId: p1, workDate: day(-3), hours: 3, description: "Weekly steering call and status pack.", billable: false, billingRate: 8500, costRate: 4200, approvalStatus: "SUBMITTED" },
  { userId: consultant, projectId: p3, projectTaskId: taskByName["Batch traceability data model"].id, workDate: day(-25), hours: 8, description: "Data model for batch genealogy.", billable: true, billingRate: 7200, costRate: 3600, approvalStatus: "APPROVED", approvedById: admin, approvedAt: at(-23) },
  { userId: consultant, projectId: p3, projectTaskId: taskByName["DRAP reporting templates"].id, workDate: day(-6), hours: 4, description: "Template scaffolding — paused pending customer data.", billable: true, billingRate: 7200, costRate: 3600, approvalStatus: "REJECTED" },
];

{
  const { error: delErr } = await db
    .from("time_log")
    .delete()
    .in("projectId", [p1, p3]);
  fail("time_log clear", delErr);

  const now = new Date().toISOString();
  const { error } = await db
    .from("time_log")
    .insert(timeLogRows.map((r) => ({ id: randomUUID(), updatedAt: now, ...r })));
  fail("time_log insert", error);
}
console.log(`  ok time_log            ${timeLogRows.length}`);

// --------------------------------------------------------------- expenses
const expenses = await upsert(
  "expense",
  [
    { expenseNumber: "EXP-2026-00001", categoryId: expenseCategory["Travel"].id, employeeUserId: consultant, projectId: p1, expenseDate: day(-12), amount: 34500, taxAmount: 0, currencyCode: "PKR", description: "Return flights to Karachi for the discovery workshop.", billableToCustomer: true, reimbursable: true, approvalStatus: "APPROVED", paymentStatus: "REIMBURSED" },
    { expenseNumber: "EXP-2026-00002", categoryId: expenseCategory["Accommodation"].id, employeeUserId: consultant, projectId: p1, expenseDate: day(-11), amount: 22000, currencyCode: "PKR", description: "Two nights, Karachi.", billableToCustomer: true, reimbursable: true, approvalStatus: "APPROVED", paymentStatus: "REIMBURSED" },
    { expenseNumber: "EXP-2026-00003", categoryId: expenseCategory["Software & Licences"].id, vendorAccountId: account["ACC-2026-00007"].id, expenseDate: day(-20), amount: 185000, taxAmount: 33300, currencyCode: "PKR", description: "Annual developer tooling renewal.", billableToCustomer: false, reimbursable: false, approvalStatus: "APPROVED", paymentStatus: "PAID" },
    { expenseNumber: "EXP-2026-00004", categoryId: expenseCategory["Client Entertainment"].id, employeeUserId: manager, expenseDate: day(-4), amount: 18500, currencyCode: "PKR", description: "Dinner with the Sapphire Textiles board ahead of the renewal.", billableToCustomer: false, reimbursable: true, approvalStatus: "SUBMITTED", paymentStatus: "UNPAID" },
    { expenseNumber: "EXP-2026-00005", categoryId: expenseCategory["Travel"].id, employeeUserId: pm, projectId: p3, expenseDate: day(-2), amount: 9800, currencyCode: "PKR", description: "Taxi and fuel, Indus Pharma site visits.", billableToCustomer: true, reimbursable: true, approvalStatus: "SUBMITTED", paymentStatus: "UNPAID" },
    { expenseNumber: "EXP-2026-00006", categoryId: expenseCategory["Office & Supplies"].id, employeeUserId: exec, expenseDate: day(-1), amount: 6400, currencyCode: "PKR", description: "Printer toner and stationery.", billableToCustomer: false, reimbursable: true, approvalStatus: "DRAFT", paymentStatus: "UNPAID" },
    { expenseNumber: "EXP-2026-00007", categoryId: expenseCategory["Subcontractor"].id, vendorAccountId: account["ACC-2026-00010"].id, projectId: p3, expenseDate: day(-8), amount: 145000, currencyCode: "PKR", description: "Contract developer, two weeks on the DRAP build.", billableToCustomer: false, reimbursable: false, approvalStatus: "APPROVED", paymentStatus: "UNPAID" },
  ],
  "expenseNumber",
);
console.log(`  ok expense             ${expenses.length}`);

// ----------------------------------------------------------- vendor bills
const vendorBills = await upsert(
  "vendor_bill",
  [
    { billNumber: "VB-2026-00001", vendorAccountId: account["ACC-2026-00007"].id, vendorInvoiceNumber: "NGS-4417", projectId: p1, billDate: day(-40), dueDate: day(-10), status: "PAID", currencyCode: "PKR", subtotal: 850000, taxAmount: 153000, totalAmount: 1003000, paidAmount: 1003000, outstandingAmount: 0, notes: "Implementation support for the Karachi Logistics build." },
    { billNumber: "VB-2026-00002", vendorAccountId: account["ACC-2026-00007"].id, vendorInvoiceNumber: "NGS-4502", projectId: p1, billDate: day(-18), dueDate: day(12), status: "PARTIALLY_PAID", currencyCode: "PKR", subtotal: 620000, taxAmount: 111600, totalAmount: 731600, paidAmount: 300000, outstandingAmount: 431600 },
    { billNumber: "VB-2026-00003", vendorAccountId: account["ACC-2026-00010"].id, vendorInvoiceNumber: "PTR-0921", projectId: p3, billDate: day(-55), dueDate: day(-25), status: "APPROVED", currencyCode: "PKR", subtotal: 320000, taxAmount: 57600, totalAmount: 377600, paidAmount: 0, outstandingAmount: 377600, notes: "Overdue — chase before the next engagement." },
    { billNumber: "VB-2026-00004", vendorAccountId: account["ACC-2026-00009"].id, vendorInvoiceNumber: "SBA-2026-11", billDate: day(-6), dueDate: day(24), status: "UNDER_REVIEW", currencyCode: "PKR", subtotal: 175000, taxAmount: 31500, totalAmount: 206500, paidAmount: 0, outstandingAmount: 206500, notes: "Advisory retainer — awaiting sign-off." },
    { billNumber: "VB-2026-00005", vendorAccountId: account["ACC-2026-00008"].id, vendorInvoiceNumber: "HCD-8890", billDate: day(-2), dueDate: day(28), status: "DRAFT", currencyCode: "USD", subtotal: 4200, taxAmount: 0, totalAmount: 4200, paidAmount: 0, outstandingAmount: 4200, notes: "Cloud hosting, Gulf region." },
  ],
  "billNumber",
);
const vendorBill = Object.fromEntries(vendorBills.map((b) => [b.billNumber, b]));
console.log(`  ok vendor_bill         ${vendorBills.length}`);

const billLineRows = [
  ["VB-2026-00001", "Subcontractor", "Senior consultant, 20 days", 20, 42500],
  ["VB-2026-00002", "Subcontractor", "Integration developer, 16 days", 16, 38750],
  ["VB-2026-00003", "Subcontractor", "Contract developer, 10 days", 10, 32000],
  ["VB-2026-00004", "Office & Supplies", "Monthly advisory retainer", 1, 175000],
  ["VB-2026-00005", "Software & Licences", "Cloud hosting, one month", 1, 4200],
];

for (const number of Object.keys(vendorBill)) {
  const rows = billLineRows
    .filter(([b]) => b === number)
    .map(([, categoryName, description, quantity, unitCost], i) => ({
      vendorBillId: vendorBill[number].id,
      expenseCategoryId: expenseCategory[categoryName].id,
      description,
      quantity,
      unitCost,
      taxRateId: gst.id,
      lineTotal: quantity * unitCost,
      sortOrder: i,
    }));
  await replaceChildren("vendor_bill_line", "vendorBillId", vendorBill[number].id, rows);
}
console.log(`  ok vendor_bill_line    ${billLineRows.length}`);

// -------------------------------------------------------- vendor payments
const vendorPayments = await upsert(
  "vendor_payment",
  [
    { paymentNumber: "VP-2026-00001", vendorAccountId: account["ACC-2026-00007"].id, paymentDate: day(-12), amount: 1003000, currencyCode: "PKR", paymentMethod: "BANK", bankAccountId: bankAccount["HBL Current — Operations"].id, referenceNumber: "OUT-556201", status: "CLEARED" },
    { paymentNumber: "VP-2026-00002", vendorAccountId: account["ACC-2026-00007"].id, paymentDate: day(-3), amount: 300000, currencyCode: "PKR", paymentMethod: "BANK", bankAccountId: bankAccount["HBL Current — Operations"].id, referenceNumber: "OUT-559877", status: "CLEARED" },
  ],
  "paymentNumber",
);
const vendorPayment = Object.fromEntries(vendorPayments.map((p) => [p.paymentNumber, p]));
console.log(`  ok vendor_payment      ${vendorPayments.length}`);

// vendor_payment_allocation has no updatedAt, and a trigger caps the total
// against a payment — so old rows go before new ones land.
{
  const paymentIds = vendorPayments.map((p) => p.id);
  const { error: delErr } = await db
    .from("vendor_payment_allocation")
    .delete()
    .in("vendorPaymentId", paymentIds);
  fail("vendor_payment_allocation clear", delErr);

  const { error } = await db.from("vendor_payment_allocation").insert([
    { id: randomUUID(), vendorPaymentId: vendorPayment["VP-2026-00001"].id, vendorBillId: vendorBill["VB-2026-00001"].id, allocatedAmount: 1003000, allocatedAt: at(-12) },
    { id: randomUUID(), vendorPaymentId: vendorPayment["VP-2026-00002"].id, vendorBillId: vendorBill["VB-2026-00002"].id, allocatedAmount: 300000, allocatedAt: at(-3) },
  ]);
  fail("vendor_payment_allocation insert", error);
}
console.log("  ok vendor_payment_allocation 2");

// ------------------------------------------------------------ activities
const activities = [
  { activityType: "CALL", subject: "Discovery call — Multan Agro Foods", ownerUserId: exec, status: "COMPLETED", priority: "MEDIUM", startAt: at(-2), dueAt: at(-2), completedAt: at(-2), description: "Walked through their current finance process.", outcome: "Budget confirmed for this financial year. Sending a proposal." },
  { activityType: "MEETING", subject: "Contract negotiation — Sapphire Textiles", ownerUserId: manager, contactId: contact["imran.sheikh@sapphiretextiles.com.pk"].id, status: "OPEN", priority: "HIGH", startAt: at(3), dueAt: at(3), description: "Agree payment milestones with the CFO.", location: "Sapphire Textiles head office, Lahore" },
  { activityType: "TASK", subject: "Prepare requirements matrix for Frontier Foods", ownerUserId: manager, status: "OPEN", priority: "HIGH", dueAt: at(5) },
  { activityType: "CALL", subject: "Follow up on the overdue Gujranwala invoice", ownerUserId: finance, contactId: contact["tariq.mehmood@gsw.com.pk"].id, status: "OPEN", priority: "CRITICAL", dueAt: at(1), description: "Invoice INV-2026-00004 is 35 days past due." },
  { activityType: "MEETING", subject: "Weekly project review — Karachi Logistics", ownerUserId: manager, contactId: contact["zainab.ali@klg.com.pk"].id, status: "OPEN", priority: "MEDIUM", startAt: at(2), dueAt: at(2), location: "Online — Teams" },
  { activityType: "REMINDER", subject: "NexGen partner agreement expires in six months", ownerUserId: manager, status: "OPEN", priority: "LOW", dueAt: at(10) },
  { activityType: "TASK", subject: "Send the server sizing study to Indus Pharma", ownerUserId: manager, contactId: contact["faisal.qureshi@induspharma.pk"].id, status: "OPEN", priority: "MEDIUM", dueAt: at(4) },
  { activityType: "CALL", subject: "Qualification call — Sialkot Sports Exports", ownerUserId: manager, status: "COMPLETED", priority: "MEDIUM", startAt: at(-5), dueAt: at(-5), completedAt: at(-5), description: "Qualification call following the NexGen referral.", outcome: "Qualified. Needs export documentation workflows." },
];

for (const a of activities) {
  await ensureRow("activity", { subject: a.subject }, a);
}
console.log(`  ok activity            ${activities.length}`);

// ------------------------------------------------------ number sequences
//
// The demo rows above carry hand-written numbers (ACC-2026-00001 and so on),
// but number_sequence still points at 1. The next record created through the
// UI would be handed a number this seed has already used, and the unique index
// would reject the insert. Advance each counter past what was seeded.
{
  const seeded = {
    Account: accounts.length,
    Lead: leads.length,
    Opportunity: opportunities.length,
    Quotation: quotations.length,
    Partner: partners.length,
    Invoice: invoices.length,
    Payment: payments.length,
    Case: cases.length,
    Project: projects.length,
    Campaign: campaigns.length,
    Contract: contracts.length,
    CommissionRecord: commissions.length,
  };

  const { data: current, error: readErr } = await db
    .from("number_sequence")
    .select("id, entityType, nextValue");
  fail("number_sequence read", readErr);

  const now = new Date().toISOString();
  for (const row of current ?? []) {
    const used = seeded[row.entityType];
    if (!used) continue;

    const shouldBe = used + 1;
    if (row.nextValue >= shouldBe) continue;

    const { error } = await db
      .from("number_sequence")
      .update({ nextValue: shouldBe, updatedAt: now })
      .eq("id", row.id);
    fail(`number_sequence ${row.entityType}`, error);
  }
}
console.log("  ok number_sequence     advanced past seeded numbers");

console.log(`
Done. Demo data seeded:

  ${accounts.length} accounts        ${contacts.length} contacts       ${products.length} products
  ${leads.length} leads           ${opportunities.length} opportunities  ${quotations.length} quotations
  ${partners.length} partners        ${invoices.length} invoices       ${payments.length} payments
  ${cases.length} support cases   ${projects.length} projects       ${activities.length} activities
  ${campaigns.length} campaigns       ${contracts.length} contracts      ${phases.length} phases
  ${milestones.length} milestones      ${tasks.length} tasks          ${timeLogRows.length} time logs
  ${expenses.length} expenses        ${vendorBills.length} vendor bills   ${vendorPayments.length} vendor payments
  ${riskRows.length} risks           ${issueRows.length} issues         ${changeRequests.length} change requests

Sign in with any seeded user — see scripts/seed-cloud.mjs for credentials.
`);
