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

// ---------------------------------------------------------- support cases
const caseCategory = await ensureRow(
  "case_category",
  { name: "Application Defect" },
  { name: "Application Defect", active: true },
);

const cases = await upsert(
  "support_case",
  [
    { caseNumber: "CASE-2026-00001", subject: "Stock valuation report shows negative quantities", description: "After the month-end close, the valuation report lists three SKUs with negative on-hand quantities. Suspected to be a timing issue between the goods receipt and the invoice posting.", accountId: account["ACC-2026-00006"].id, contactId: contact["tariq.mehmood@gsw.com.pk"].id, categoryId: caseCategory.id, caseType: "PROBLEM", status: "IN_PROGRESS", priority: "CRITICAL", source: "EMAIL", ownerUserId: admin },
    { caseNumber: "CASE-2026-00002", subject: "Cannot generate the batch traceability export", description: "The export runs for several minutes and then fails without an error message. Reproducible on batches with more than 500 line items.", accountId: account["ACC-2026-00002"].id, contactId: contact["faisal.qureshi@induspharma.pk"].id, categoryId: caseCategory.id, caseType: "INCIDENT", status: "WAITING_FOR_CUSTOMER", priority: "HIGH", source: "PORTAL", ownerUserId: admin },
    { caseNumber: "CASE-2026-00003", subject: "Request: add a warehouse to the receiving workflow", description: "The new Sheikhupura warehouse needs adding to the goods receipt dropdown and the stock transfer routes.", accountId: account["ACC-2026-00001"].id, contactId: contact["nadia.baig@sapphiretextiles.com.pk"].id, caseType: "REQUEST", status: "NEW", priority: "MEDIUM", source: "EMAIL", ownerUserId: exec },
    { caseNumber: "CASE-2026-00004", subject: "How do I schedule a recurring invoice?", description: "Customer asked whether the CRM can raise the support retainer invoice automatically each month.", accountId: account["ACC-2026-00003"].id, contactId: contact["zainab.ali@klg.com.pk"].id, caseType: "QUESTION", status: "RESOLVED", priority: "LOW", source: "WHATSAPP", ownerUserId: exec, resolution: "Walked the customer through the recurring invoice template. No product change needed.", resolvedAt: at(-3), satisfactionScore: 5 },
    { caseNumber: "CASE-2026-00005", subject: "Login fails for three finance users", description: "Three finance team members receive an invalid credentials error despite a successful password reset.", accountId: account["ACC-2026-00006"].id, contactId: contact["tariq.mehmood@gsw.com.pk"].id, categoryId: caseCategory.id, caseType: "INCIDENT", status: "ASSIGNED", priority: "HIGH", source: "PHONE", ownerUserId: admin },
    { caseNumber: "CASE-2026-00006", subject: "Dashboard totals differ from the ledger", description: "The revenue tile on the finance dashboard reads about 4% lower than the general ledger for the same period.", accountId: account["ACC-2026-00001"].id, contactId: contact["imran.sheikh@sapphiretextiles.com.pk"].id, categoryId: caseCategory.id, caseType: "PROBLEM", status: "CLOSED", priority: "MEDIUM", source: "EMAIL", ownerUserId: admin, rootCause: "Currency rounding applied at display time rather than at conversion.", resolution: "Corrected the multi-currency rounding order. Fixed in release 4.2.1.", resolvedAt: at(-20), closedAt: at(-18), satisfactionScore: 4 },
  ],
  "caseNumber",
);
console.log(`  ok support_case        ${cases.length}`);

// -------------------------------------------------------------- projects
const projects = await upsert(
  "project",
  [
    { projectNumber: "PRJ-2026-00001", name: "Karachi Logistics — CRM Implementation", accountId: account["ACC-2026-00003"].id, projectManagerId: manager, opportunityId: opp["OPP-2026-00003"].id, status: "ACTIVE", billingType: "MILESTONE", startDate: day(-35), plannedEndDate: day(55), currencyCode: "PKR", contractValue: 3275000, approvedHours: 1200, completionPercent: 45, scope: "Full CRM rollout with data migration from two legacy systems.", health: "GREEN" },
    { projectNumber: "PRJ-2026-00002", name: "Sapphire Textiles — Second Site Rollout", accountId: account["ACC-2026-00001"].id, projectManagerId: manager, status: "PLANNING", billingType: "MILESTONE", startDate: day(14), plannedEndDate: day(140), currencyCode: "PKR", contractValue: 4850000, approvedHours: 1800, completionPercent: 0, scope: "ERP extension to the Sheikhupura plant. Awaiting contract signature.", health: "GREEN" },
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
    { projectId: project["PRJ-2026-00001"].id, userId: manager, projectRole: "Project Manager", allocationPercent: 50, billingRate: 8500, costRate: 4200, active: true },
    { projectId: project["PRJ-2026-00001"].id, userId: exec, projectRole: "Functional Consultant", allocationPercent: 80, billingRate: 6500, costRate: 3100, active: true },
    { projectId: project["PRJ-2026-00002"].id, userId: manager, projectRole: "Project Manager", allocationPercent: 30, billingRate: 8500, costRate: 4200, active: true },
    { projectId: project["PRJ-2026-00003"].id, userId: admin, projectRole: "Project Manager", allocationPercent: 40, billingRate: 9000, costRate: 4500, active: true },
    { projectId: project["PRJ-2026-00003"].id, userId: exec, projectRole: "Technical Lead", allocationPercent: 60, billingRate: 7200, costRate: 3600, active: true },
  ],
  "projectId,userId",
);
console.log("  ok project_member      5");

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

console.log(`
Done. Demo data seeded:

  ${accounts.length} accounts        ${contacts.length} contacts       ${products.length} products
  ${leads.length} leads           ${opportunities.length} opportunities  ${quotations.length} quotations
  ${partners.length} partners        ${invoices.length} invoices       ${payments.length} payments
  ${cases.length} support cases   ${projects.length} projects       ${activities.length} activities

Sign in with any seeded user — see scripts/seed-cloud.mjs for credentials.
`);
