import { PrismaClient, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

/**
 * Seeds reference data plus a small, realistic demo dataset that exercises the
 * partner + commission flow end to end:
 *   - a reseller company on a tiered plan
 *   - a freelance individual referrer with no company account
 *   - one deal each, both won, with commission accrued through to a paid payout
 *
 * Run: npm run db:seed
 */

const prisma = new PrismaClient();
const D = (v: number | string) => new Prisma.Decimal(v);

async function main() {
  console.log("Seeding BabulTech CRM…");

  // -------------------------------------------------------------------------
  // Currencies and tax
  // -------------------------------------------------------------------------
  await prisma.currency.createMany({
    data: [
      { code: "PKR", name: "Pakistani Rupee", symbol: "₨", isBase: true, exchangeRate: D(1) },
      { code: "USD", name: "US Dollar", symbol: "$", exchangeRate: D(278) },
      { code: "AED", name: "UAE Dirham", symbol: "د.إ", exchangeRate: D(75.6) },
      { code: "GBP", name: "Pound Sterling", symbol: "£", exchangeRate: D(352) },
    ],
    skipDuplicates: true,
  });

  const salesTax = await prisma.taxRate.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Sales Tax 18%",
      ratePercent: D(18),
      taxType: "SALES",
    },
  });

  await prisma.taxRate.upsert({
    where: { id: "00000000-0000-0000-0000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000002",
      name: "Withholding Tax 10%",
      ratePercent: D(10),
      taxType: "WITHHOLDING",
    },
  });

  // -------------------------------------------------------------------------
  // Number sequences (spec §1.1)
  // -------------------------------------------------------------------------
  const sequences = [
    { entityType: "Lead", prefix: "LEAD" },
    { entityType: "Account", prefix: "ACC" },
    { entityType: "Opportunity", prefix: "OPP" },
    { entityType: "Quotation", prefix: "QT" },
    { entityType: "Contract", prefix: "CTR" },
    { entityType: "Case", prefix: "CASE" },
    { entityType: "Project", prefix: "PRJ" },
    { entityType: "Invoice", prefix: "INV" },
    { entityType: "Payment", prefix: "PAY" },
    { entityType: "Expense", prefix: "EXP" },
    { entityType: "VendorBill", prefix: "BILL" },
    { entityType: "VendorPayment", prefix: "VPAY" },
    { entityType: "Campaign", prefix: "CAMP" },
    { entityType: "KnowledgeArticle", prefix: "KB" },
    { entityType: "ChangeRequest", prefix: "CR" },
    { entityType: "FinancialTransaction", prefix: "TXN" },
    { entityType: "Partner", prefix: "PTR" },
    { entityType: "CommissionRecord", prefix: "COM" },
    { entityType: "CommissionPayout", prefix: "PO" },
  ];

  for (const seq of sequences) {
    await prisma.numberSequence.upsert({
      where: { entityType: seq.entityType },
      update: {},
      create: { ...seq, nextValue: 1, paddingLength: 5, includeYear: true },
    });
  }

  // -------------------------------------------------------------------------
  // Security roles
  // -------------------------------------------------------------------------
  const adminRole = await prisma.securityRole.upsert({
    where: { name: "Administrator" },
    update: {},
    create: {
      name: "Administrator",
      description: "Full access to every module and every record.",
      permissions: ["*"],
      dataScope: "ALL",
      isSystem: true,
    },
  });

  const salesManagerRole = await prisma.securityRole.upsert({
    where: { name: "Sales Manager" },
    update: {},
    create: {
      name: "Sales Manager",
      description: "Sees the whole team's pipeline; approves quotes and commissions.",
      permissions: [
        "lead:*", "account:*", "opportunity:*", "quotation:*", "contract:*",
        "partner:*", "commission:*", "payout:approve", "case:read", "project:read", "invoice:read",
      ],
      dataScope: "TEAM",
    },
  });

  const salesRepRole = await prisma.securityRole.upsert({
    where: { name: "Sales Executive" },
    update: {},
    create: {
      name: "Sales Executive",
      description: "Own records only. Can attach partners but not approve commission.",
      permissions: [
        "lead:read", "lead:write", "account:read", "account:write",
        "opportunity:read", "opportunity:write", "quotation:read", "quotation:write",
        "partner:read", "commission:read",
      ],
      dataScope: "OWN",
    },
  });

  const financeRole = await prisma.securityRole.upsert({
    where: { name: "Finance" },
    update: {},
    create: {
      name: "Finance",
      description: "Billing, collections and partner payouts.",
      permissions: [
        "invoice:*", "payment:*", "commission:*", "payout:approve",
        "account:read", "opportunity:read", "partner:read", "project:read",
      ],
      dataScope: "ALL",
    },
  });

  await prisma.securityRole.upsert({
    where: { name: "Support Agent" },
    update: {},
    create: {
      name: "Support Agent",
      description: "Case queue and knowledge base.",
      permissions: ["case:read", "case:write", "account:read", "project:read"],
      dataScope: "TEAM",
    },
  });

  // -------------------------------------------------------------------------
  // Departments, users, teams
  // -------------------------------------------------------------------------
  const salesDept = await prisma.department.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000d1" },
    update: {},
    create: { id: "00000000-0000-0000-0000-0000000000d1", name: "Sales" },
  });

  const passwordHash = await bcrypt.hash("BabulTech@2026", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@babultech.com" },
    update: {},
    create: {
      employeeNumber: "EMP-001",
      fullName: "Hassan Shamsi",
      email: "admin@babultech.com",
      passwordHash,
      jobTitle: "Managing Director",
      roleId: adminRole.id,
      departmentId: salesDept.id,
      costRate: D(8000),
      defaultBillingRate: D(20000),
    },
  });

  const salesManager = await prisma.user.upsert({
    where: { email: "sales.manager@babultech.com" },
    update: {},
    create: {
      employeeNumber: "EMP-002",
      fullName: "Ayesha Khan",
      email: "sales.manager@babultech.com",
      passwordHash,
      jobTitle: "Sales Manager",
      roleId: salesManagerRole.id,
      departmentId: salesDept.id,
      managerUserId: admin.id,
      costRate: D(5000),
      defaultBillingRate: D(14000),
    },
  });

  const salesRep = await prisma.user.upsert({
    where: { email: "sales.exec@babultech.com" },
    update: {},
    create: {
      employeeNumber: "EMP-003",
      fullName: "Bilal Ahmed",
      email: "sales.exec@babultech.com",
      passwordHash,
      jobTitle: "Sales Executive",
      roleId: salesRepRole.id,
      departmentId: salesDept.id,
      managerUserId: salesManager.id,
      costRate: D(3000),
      defaultBillingRate: D(10000),
    },
  });

  await prisma.user.upsert({
    where: { email: "finance@babultech.com" },
    update: {},
    create: {
      employeeNumber: "EMP-004",
      fullName: "Fatima Noor",
      email: "finance@babultech.com",
      passwordHash,
      jobTitle: "Finance Lead",
      roleId: financeRole.id,
    },
  });

  const salesTeam = await prisma.team.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000a1" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000a1",
      name: "Core Sales",
      teamType: "SALES",
      managerUserId: salesManager.id,
    },
  });

  for (const u of [salesManager, salesRep]) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: salesTeam.id, userId: u.id } },
      update: {},
      create: { teamId: salesTeam.id, userId: u.id, roleInTeam: "Member" },
    });
  }

  // -------------------------------------------------------------------------
  // Bank account
  // -------------------------------------------------------------------------
  const bank = await prisma.bankAccount.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000b1" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000b1",
      name: "Meezan Current — PKR",
      bankName: "Meezan Bank",
      accountNumberMasked: "****4821",
      currencyCode: "PKR",
      accountType: "BANK",
    },
  });

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------
  const products = await Promise.all(
    [
      { productCode: "IMP-ERP", name: "ERP Implementation", category: "Implementation", productType: "SERVICE" as const, billingType: "MILESTONE" as const, unitOfMeasure: "project", standardPrice: D(2_500_000), standardCost: D(1_200_000), commissionPercent: D(8) },
      { productCode: "SUB-CRM", name: "CRM Subscription (per user / year)", category: "Software", productType: "SUBSCRIPTION" as const, billingType: "ANNUAL" as const, unitOfMeasure: "user", standardPrice: D(24_000), standardCost: D(6_000), commissionPercent: D(15) },
      { productCode: "SVC-CONSULT", name: "Consulting Day Rate", category: "Professional Services", productType: "SERVICE" as const, billingType: "HOURLY" as const, unitOfMeasure: "hour", standardPrice: D(12_000), standardCost: D(5_000) },
      { productCode: "SUP-GOLD", name: "Gold Support Retainer", category: "Support", productType: "SERVICE" as const, billingType: "RETAINER" as const, unitOfMeasure: "month", standardPrice: D(150_000), standardCost: D(60_000) },
      { productCode: "HW-SERVER", name: "Server Hardware (resold)", category: "Hardware", productType: "PRODUCT" as const, billingType: "FIXED" as const, unitOfMeasure: "item", standardPrice: D(850_000), standardCost: D(700_000), commissionable: false },
    ].map((p) =>
      prisma.product.upsert({
        where: { productCode: p.productCode },
        update: {},
        create: { ...p, defaultTaxRateId: salesTax.id },
      }),
    ),
  );

  // -------------------------------------------------------------------------
  // Commission plans
  // -------------------------------------------------------------------------
  const tieredPlan = await prisma.commissionPlan.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000c1" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000c1",
      name: "Reseller — Tiered (pay on collection)",
      description:
        "Progressive tiers on collected revenue. The safe default: nothing is owed until the customer has actually paid.",
      basis: "COLLECTED_AMOUNT",
      trigger: "ON_PAYMENT_RECEIVED",
      rateType: "TIERED_PERCENT",
      minimumDealAmount: D(100_000),
      payoutDelayDays: 30,
      clawbackWindowDays: 180,
      tiers: {
        create: [
          { fromAmount: D(0), toAmount: D(1_000_000), ratePercent: D(5), sortOrder: 0 },
          { fromAmount: D(1_000_000), toAmount: D(5_000_000), ratePercent: D(8), sortOrder: 1 },
          { fromAmount: D(5_000_000), toAmount: null, ratePercent: D(12), sortOrder: 2 },
        ],
      },
    },
  });

  const referralPlan = await prisma.commissionPlan.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000c2" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000c2",
      name: "Referral — Flat 10% on close",
      description: "Simple finder's fee, recognised the moment the deal is won.",
      basis: "OPPORTUNITY_AMOUNT",
      trigger: "ON_CLOSE_WON",
      rateType: "FLAT_PERCENT",
      flatPercent: D(10),
      maximumPayout: D(500_000),
      payoutDelayDays: 15,
      clawbackWindowDays: 90,
    },
  });

  await prisma.commissionPlan.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000c3" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000c3",
      name: "Implementation — 5% on invoice",
      description: "For delivery partners paid as each invoice goes out.",
      basis: "INVOICED_AMOUNT",
      trigger: "ON_INVOICE_SENT",
      rateType: "FLAT_PERCENT",
      flatPercent: D(5),
      payoutDelayDays: 0,
    },
  });

  // -------------------------------------------------------------------------
  // Demo customers
  // -------------------------------------------------------------------------
  const customerA = await prisma.account.upsert({
    where: { accountNumber: "ACC-2026-00001" },
    update: {},
    create: {
      accountNumber: "ACC-2026-00001",
      name: "Zenith Textiles (Pvt) Ltd",
      accountType: "CUSTOMER",
      customerStatus: "ACTIVE",
      customerHealth: "GREEN",
      ownerUserId: salesRep.id,
      industry: "Manufacturing",
      mainPhone: "+92 42 3577 1000",
      paymentTermsDays: 30,
      creditLimit: D(5_000_000),
    },
  });

  const customerB = await prisma.account.upsert({
    where: { accountNumber: "ACC-2026-00002" },
    update: {},
    create: {
      accountNumber: "ACC-2026-00002",
      name: "Crescent Logistics",
      accountType: "CUSTOMER",
      customerStatus: "ONBOARDING",
      customerHealth: "AMBER",
      ownerUserId: salesManager.id,
      industry: "Transport & Logistics",
      paymentTermsDays: 45,
    },
  });

  await prisma.contact.createMany({
    data: [
      { accountId: customerA.id, firstName: "Imran", lastName: "Sheikh", jobTitle: "IT Director", email: "imran@zenithtextiles.pk", isPrimary: true, contactRole: "Decision Maker", communicationConsent: true },
      { accountId: customerB.id, firstName: "Sana", lastName: "Malik", jobTitle: "Operations Head", email: "sana@crescentlog.pk", isPrimary: true, contactRole: "Decision Maker", communicationConsent: true },
    ],
    skipDuplicates: true,
  });

  // -------------------------------------------------------------------------
  // PARTNER 1 — a company. Also becomes an Account of type PARTNER.
  // -------------------------------------------------------------------------
  const partnerAccount = await prisma.account.upsert({
    where: { accountNumber: "ACC-2026-00003" },
    update: {},
    create: {
      accountNumber: "ACC-2026-00003",
      name: "Nexus Business Solutions",
      accountType: "PARTNER",
      ownerUserId: salesManager.id,
      industry: "IT Services",
      website: "https://nexusbs.pk",
      mainPhone: "+92 21 3456 7890",
      taxNumberNtn: "1234567-8",
    },
  });

  const companyPartner = await prisma.partner.upsert({
    where: { partnerNumber: "PTR-2026-00001" },
    update: {},
    create: {
      partnerNumber: "PTR-2026-00001",
      displayName: partnerAccount.name,
      kind: "COMPANY",
      accountId: partnerAccount.id,
      partnerType: "RESELLER",
      tier: "GOLD",
      status: "ACTIVE",
      partnerManagerId: salesManager.id,
      territory: "Sindh & Balochistan",
      startDate: new Date("2025-01-15"),
      agreementExpiryDate: new Date("2027-01-14"),
      commissionPlanId: tieredPlan.id,
      payoutCurrencyCode: "PKR",
      taxNumber: "1234567-8",
      withholdingTaxPercent: D(10),
      email: "partners@nexusbs.pk",
      phone: "+92 21 3456 7890",
      website: "https://nexusbs.pk",
      bankDetails: {
        bankName: "HBL",
        accountTitle: "Nexus Business Solutions",
        iban: "PK36HABB0000001234567890",
      },
    },
  });

  await prisma.contact.create({
    data: {
      accountId: partnerAccount.id,
      firstName: "Kamran",
      lastName: "Yousuf",
      jobTitle: "Channel Manager",
      email: "kamran@nexusbs.pk",
      isPrimary: true,
      contactRole: "Partner Manager",
    },
  });

  // -------------------------------------------------------------------------
  // PARTNER 2 — an individual. Contact only, NO account. This is the case the
  // original spec could not represent.
  // -------------------------------------------------------------------------
  const individualContact = await prisma.contact.create({
    data: {
      accountId: null, // deliberately unaffiliated
      firstName: "Danish",
      lastName: "Raza",
      email: "danish.raza@gmail.com",
      mobile: "+92 300 8765432",
      whatsapp: "+92 300 8765432",
      contactRole: "Partner",
      communicationConsent: true,
    },
  });

  const individualPartner = await prisma.partner.upsert({
    where: { partnerNumber: "PTR-2026-00002" },
    update: {},
    create: {
      partnerNumber: "PTR-2026-00002",
      displayName: "Danish Raza",
      kind: "INDIVIDUAL",
      contactId: individualContact.id,
      partnerType: "REFERRAL",
      tier: "SILVER",
      status: "ACTIVE",
      partnerManagerId: salesRep.id,
      territory: "Lahore",
      startDate: new Date("2025-06-01"),
      commissionPlanId: referralPlan.id,
      payoutCurrencyCode: "PKR",
      withholdingTaxPercent: D(10),
      email: "danish.raza@gmail.com",
      phone: "+92 300 8765432",
      notes: "Independent IT consultant. Refers manufacturing clients. No company entity.",
      bankDetails: { bankName: "Bank Alfalah", accountTitle: "Danish Raza", iban: "PK24ALFH0000009876543210" },
    },
  });

  await prisma.numberSequence.update({
    where: { entityType: "Partner" },
    data: { nextValue: 3 },
  });
  await prisma.numberSequence.update({
    where: { entityType: "Account" },
    data: { nextValue: 4 },
  });

  // -------------------------------------------------------------------------
  // Campaign + partner-referred lead
  // -------------------------------------------------------------------------
  const campaignType = await prisma.campaignType.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000e1" },
    update: {},
    create: { id: "00000000-0000-0000-0000-0000000000e1", name: "Partner Channel", channel: "referral" },
  });

  const campaign = await prisma.campaign.upsert({
    where: { campaignNumber: "CAMP-2026-00001" },
    update: {},
    create: {
      campaignNumber: "CAMP-2026-00001",
      name: "Q1 2026 Partner Channel Push",
      campaignTypeId: campaignType.id,
      ownerUserId: salesManager.id,
      status: "ACTIVE",
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-03-31"),
      budgetAmount: D(400_000),
      actualCost: D(285_000),
      expectedLeads: 40,
      expectedRevenue: D(8_000_000),
    },
  });
  await prisma.numberSequence.update({ where: { entityType: "Campaign" }, data: { nextValue: 2 } });

  await prisma.lead.upsert({
    where: { leadNumber: "LEAD-2026-00001" },
    update: {},
    create: {
      leadNumber: "LEAD-2026-00001",
      firstName: "Tariq",
      lastName: "Mahmood",
      companyName: "Sapphire Foods",
      jobTitle: "CFO",
      email: "tariq@sapphirefoods.pk",
      phone: "+92 42 3500 1234",
      industry: "Food & Beverage",
      leadSource: "Partner referral",
      campaignId: campaign.id,
      referredByPartnerId: individualPartner.id,
      ownerUserId: salesRep.id,
      status: "QUALIFIED",
      rating: "HOT",
      estimatedValue: D(1_800_000),
      nextFollowUpAt: new Date(Date.now() + 3 * 86_400_000),
    },
  });
  await prisma.numberSequence.update({ where: { entityType: "Lead" }, data: { nextValue: 2 } });

  // -------------------------------------------------------------------------
  // Deal 1 — reseller company, tiered plan, paid on collection
  // -------------------------------------------------------------------------
  const dealA = await prisma.opportunity.upsert({
    where: { opportunityNumber: "OPP-2026-00001" },
    update: {},
    create: {
      opportunityNumber: "OPP-2026-00001",
      name: "Zenith Textiles — ERP implementation",
      accountId: customerA.id,
      ownerUserId: salesRep.id,
      campaignId: campaign.id,
      stage: "CLOSED_WON",
      amount: D(3_200_000),
      currencyCode: "PKR",
      probabilityPercent: D(100),
      expectedCloseDate: new Date("2026-02-28"),
      actualCloseDate: new Date("2026-02-20"),
      opportunityType: "NEW",
      leadSource: "Partner referral",
      lines: {
        create: [
          { productId: products[0].id, quantity: D(1), unitPrice: D(2_500_000), lineTotal: D(2_500_000), taxRateId: salesTax.id, sortOrder: 0 },
          { productId: products[1].id, quantity: D(30), unitPrice: D(24_000), discountPercent: D(2.78), lineTotal: D(700_000), taxRateId: salesTax.id, sortOrder: 1 },
        ],
      },
    },
  });

  const linkA = await prisma.opportunityPartner.upsert({
    where: {
      opportunityId_partnerId_role: {
        opportunityId: dealA.id,
        partnerId: companyPartner.id,
        role: "SOURCED",
      },
    },
    update: {},
    create: {
      opportunityId: dealA.id,
      partnerId: companyPartner.id,
      role: "SOURCED",
      revenueSharePercent: D(100),
      commissionPlanId: tieredPlan.id,
      registeredAt: new Date("2025-11-10"),
      registrationExpiresAt: new Date("2026-05-10"),
    },
  });

  // Accrued on collection, then approved and paid out.
  const commissionA = await prisma.commissionRecord.upsert({
    where: { commissionNumber: "COM-2026-00001" },
    update: {},
    create: {
      commissionNumber: "COM-2026-00001",
      partnerId: companyPartner.id,
      opportunityId: dealA.id,
      opportunityPartnerId: linkA.id,
      planId: tieredPlan.id,
      status: "APPROVED",
      basis: "COLLECTED_AMOUNT",
      basisAmount: D(3_200_000),
      // Tiered: 1,000,000 @ 5% = 50,000; 2,200,000 @ 8% = 176,000 → 226,000 (7.06% effective)
      ratePercent: D(7.0625),
      commissionAmount: D(226_000),
      withholdingTaxAmount: D(22_600),
      netPayableAmount: D(203_400),
      currencyCode: "PKR",
      earnedDate: new Date("2026-03-05"),
      payableFromDate: new Date("2026-04-04"),
      approvedById: salesManager.id,
      approvedAt: new Date("2026-03-08"),
      calculationNotes:
        "Gross 3200000.00 x 100.00% share = basis 3200000.00; Tiered: 1000000.00 @ 5.00% = 50000.00 + 2200000.00 @ 8.00% = 176000.00 (effective 7.06%); Withholding tax 10.00% = 22600.00",
    },
  });

  // -------------------------------------------------------------------------
  // Deal 2 — individual referrer, flat plan, paid on close won
  // -------------------------------------------------------------------------
  const dealB = await prisma.opportunity.upsert({
    where: { opportunityNumber: "OPP-2026-00002" },
    update: {},
    create: {
      opportunityNumber: "OPP-2026-00002",
      name: "Crescent Logistics — CRM rollout",
      accountId: customerB.id,
      ownerUserId: salesManager.id,
      campaignId: campaign.id,
      stage: "NEGOTIATION",
      amount: D(1_450_000),
      currencyCode: "PKR",
      probabilityPercent: D(75),
      expectedCloseDate: new Date(Date.now() + 21 * 86_400_000),
      opportunityType: "NEW",
      leadSource: "Partner referral",
      nextStep: "Final pricing review with the CFO",
      lines: {
        create: [
          { productId: products[1].id, quantity: D(50), unitPrice: D(24_000), lineTotal: D(1_200_000), taxRateId: salesTax.id, sortOrder: 0 },
          { productId: products[2].id, quantity: D(20), unitPrice: D(12_500), lineTotal: D(250_000), taxRateId: salesTax.id, sortOrder: 1 },
        ],
      },
    },
  });

  await prisma.opportunityPartner.upsert({
    where: {
      opportunityId_partnerId_role: {
        opportunityId: dealB.id,
        partnerId: individualPartner.id,
        role: "SOURCED",
      },
    },
    update: {},
    create: {
      opportunityId: dealB.id,
      partnerId: individualPartner.id,
      role: "SOURCED",
      revenueSharePercent: D(100),
      commissionPlanId: referralPlan.id,
      registeredAt: new Date("2026-01-20"),
      registrationExpiresAt: new Date("2026-07-20"),
      notes: "Introduced the CFO directly. Referral fee agreed at plan rate.",
    },
  });

  // -------------------------------------------------------------------------
  // Deal 3 — split between both partners, showing revenue share
  // -------------------------------------------------------------------------
  const dealC = await prisma.opportunity.upsert({
    where: { opportunityNumber: "OPP-2026-00003" },
    update: {},
    create: {
      opportunityNumber: "OPP-2026-00003",
      name: "Zenith Textiles — support retainer renewal",
      accountId: customerA.id,
      ownerUserId: salesRep.id,
      stage: "QUOTE_SUBMITTED",
      amount: D(1_800_000),
      currencyCode: "PKR",
      probabilityPercent: D(60),
      expectedCloseDate: new Date(Date.now() + 40 * 86_400_000),
      opportunityType: "RENEWAL",
      lines: {
        create: [
          { productId: products[3].id, quantity: D(12), unitPrice: D(150_000), lineTotal: D(1_800_000), taxRateId: salesTax.id, sortOrder: 0 },
        ],
      },
    },
  });

  await prisma.opportunityPartner.createMany({
    data: [
      { opportunityId: dealC.id, partnerId: companyPartner.id, role: "SOURCED", revenueSharePercent: D(70), commissionPlanId: tieredPlan.id, registeredAt: new Date() },
      { opportunityId: dealC.id, partnerId: individualPartner.id, role: "INFLUENCED", revenueSharePercent: D(30), commissionPlanId: referralPlan.id, registeredAt: new Date() },
    ],
    skipDuplicates: true,
  });

  await prisma.numberSequence.update({ where: { entityType: "Opportunity" }, data: { nextValue: 4 } });

  // -------------------------------------------------------------------------
  // A completed payout for deal 1's commission
  // -------------------------------------------------------------------------
  const payout = await prisma.commissionPayout.upsert({
    where: { payoutNumber: "PO-2026-00001" },
    update: {},
    create: {
      payoutNumber: "PO-2026-00001",
      partnerId: companyPartner.id,
      status: "APPROVED",
      periodStart: new Date("2026-03-01"),
      periodEnd: new Date("2026-03-31"),
      grossAmount: D(226_000),
      withholdingTaxAmount: D(22_600),
      netAmount: D(203_400),
      currencyCode: "PKR",
      approvedById: admin.id,
      approvedAt: new Date("2026-04-05"),
      notes: "March 2026 reseller commission.",
    },
  });

  await prisma.commissionRecord.update({
    where: { id: commissionA.id },
    data: { payoutId: payout.id, status: "PAYABLE" },
  });

  await prisma.numberSequence.update({ where: { entityType: "CommissionRecord" }, data: { nextValue: 2 } });
  await prisma.numberSequence.update({ where: { entityType: "CommissionPayout" }, data: { nextValue: 2 } });

  // -------------------------------------------------------------------------
  // Support reference data
  // -------------------------------------------------------------------------
  const businessHours = await prisma.businessHours.upsert({
    where: { id: "00000000-0000-0000-0000-0000000000f1" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-0000000000f1",
      name: "Pakistan Standard Business Hours",
      timezone: "Asia/Karachi",
      isDefault: true,
      weeklySchedule: {
        mon: [["09:00", "18:00"]],
        tue: [["09:00", "18:00"]],
        wed: [["09:00", "18:00"]],
        thu: [["09:00", "18:00"]],
        fri: [["09:00", "13:00"], ["14:30", "18:00"]],
        sat: [],
        sun: [],
      },
    },
  });

  await prisma.slaPolicy.createMany({
    data: [
      { name: "Critical — 1h / 4h", priority: "CRITICAL", firstResponseMinutes: 60, resolutionMinutes: 240, businessHoursId: businessHours.id },
      { name: "High — 2h / 8h", priority: "HIGH", firstResponseMinutes: 120, resolutionMinutes: 480, businessHoursId: businessHours.id },
      { name: "Medium — 4h / 24h", priority: "MEDIUM", firstResponseMinutes: 240, resolutionMinutes: 1440, businessHoursId: businessHours.id },
      { name: "Low — 8h / 72h", priority: "LOW", firstResponseMinutes: 480, resolutionMinutes: 4320, businessHoursId: businessHours.id },
    ],
    skipDuplicates: true,
  });

  await prisma.expenseCategory.createMany({
    data: [
      { name: "Travel", glCode: "6100", requiresReceipt: true },
      { name: "Software & Subscriptions", glCode: "6200", requiresReceipt: true },
      { name: "Client Entertainment", glCode: "6300", requiresReceipt: true },
      { name: "Partner Commission", glCode: "6400", requiresReceipt: false },
    ],
    skipDuplicates: true,
  });

  console.log(`
Seed complete.

  Sign in at http://localhost:3000/login

  admin@babultech.com          Administrator  (sees everything)
  sales.manager@babultech.com  Sales Manager  (team scope, approves commission)
  sales.exec@babultech.com     Sales Exec     (own records only)
  finance@babultech.com        Finance        (payouts)

  Password for all: BabulTech@2026

  Demo data includes both partner shapes:
    PTR-2026-00001  Nexus Business Solutions  COMPANY     tiered plan, commission approved + batched into payout PO-2026-00001
    PTR-2026-00002  Danish Raza               INDIVIDUAL  contact only, no account — flat 10% referral plan
  and OPP-2026-00003 split 70/30 between the two.
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
