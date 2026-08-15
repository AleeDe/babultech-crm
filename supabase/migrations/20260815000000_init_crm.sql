-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TeamType" AS ENUM ('SALES', 'SUPPORT', 'PROJECT', 'FINANCE', 'MARKETING');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('PROSPECT', 'CUSTOMER', 'PARTNER', 'VENDOR', 'COMPETITOR', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'AT_RISK', 'CHURNED');

-- CreateEnum
CREATE TYPE "HealthStatus" AS ENUM ('GREEN', 'AMBER', 'RED');

-- CreateEnum
CREATE TYPE "PreferredChannel" AS ENUM ('EMAIL', 'PHONE', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('PLANNED', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'ASSIGNED', 'ATTEMPTED_CONTACT', 'CONTACTED', 'DISCOVERY_SCHEDULED', 'QUALIFIED', 'NURTURING', 'DISQUALIFIED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "LeadRating" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('DISCOVERY', 'QUALIFICATION', 'REQUIREMENTS', 'SOLUTION_PROPOSED', 'QUOTE_SUBMITTED', 'NEGOTIATION', 'VERBAL_CONFIRMATION', 'CLOSED_WON', 'CLOSED_LOST', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('NEW', 'RENEWAL', 'UPSELL', 'CROSS_SELL');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PRODUCT', 'SERVICE', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "BillingType" AS ENUM ('FIXED', 'HOURLY', 'RETAINER', 'MILESTONE', 'ANNUAL');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVISED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'SENT_FOR_SIGNATURE', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED');

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'MILESTONE', 'ANNUAL');

-- CreateEnum
CREATE TYPE "RenewalType" AS ENUM ('MANUAL', 'AUTO_RENEW');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_INTERNAL_TEAM', 'WAITING_FOR_THIRD_PARTY', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('INCIDENT', 'REQUEST', 'QUESTION', 'PROBLEM');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CaseSource" AS ENUM ('EMAIL', 'PORTAL', 'PHONE', 'WHATSAPP', 'INTERNAL');

-- CreateEnum
CREATE TYPE "CaseCommentType" AS ENUM ('CUSTOMER_COMMENT', 'AGENT_RESPONSE', 'INTERNAL_NOTE');

-- CreateEnum
CREATE TYPE "SlaEventType" AS ENUM ('STARTED', 'PAUSED', 'RESUMED', 'STOPPED', 'BREACHED');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ArticleVisibility" AS ENUM ('INTERNAL', 'CUSTOMER_PORTAL');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'PLANNING', 'ACTIVE', 'ON_HOLD', 'AT_RISK', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PhaseStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'COMPLETED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'DELAYED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'UNDER_REVIEW', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TimeApprovalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TrainingType" AS ENUM ('CUSTOMER', 'INTERNAL', 'WORKSHOP', 'KNOWLEDGE_TRANSFER');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('ONSITE', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "TrainingStatus" AS ENUM ('PLANNED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('INVITED', 'REGISTERED', 'DECLINED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'PARTIAL');

-- CreateEnum
CREATE TYPE "CompletionStatus" AS ENUM ('COMPLETED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MONITORING', 'MITIGATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChangeRequestStatus" AS ENUM ('REQUESTED', 'ASSESSED', 'APPROVED', 'IMPLEMENTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "VendorBillStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK', 'CHEQUE', 'CASH', 'CARD', 'WALLET');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CLEARED', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ExpenseApprovalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ExpensePaymentStatus" AS ENUM ('UNPAID', 'PAID', 'REIMBURSED');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('BANK', 'CASH', 'WALLET');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('CUSTOMER_PAYMENT', 'VENDOR_PAYMENT', 'EXPENSE', 'COMMISSION_PAYOUT', 'REFUND', 'FEE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('INCOMING', 'OUTGOING');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TaxType" AS ENUM ('SALES', 'WITHHOLDING', 'PURCHASE');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TASK', 'CALL', 'MEETING', 'REMINDER');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmailDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('DRAFT', 'SENT', 'RECEIVED', 'FAILED');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('PRIVATE', 'TEAM', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "PartnerKind" AS ENUM ('COMPANY', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "PartnerType" AS ENUM ('REFERRAL', 'RESELLER', 'IMPLEMENTATION', 'TECHNOLOGY', 'DISTRIBUTOR');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('PROSPECTIVE', 'ACTIVE', 'INACTIVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PartnerTier" AS ENUM ('REGISTERED', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "PartnerRole" AS ENUM ('SOURCED', 'INFLUENCED', 'RESOLD', 'DELIVERED');

-- CreateEnum
CREATE TYPE "CommissionBasis" AS ENUM ('OPPORTUNITY_AMOUNT', 'INVOICED_AMOUNT', 'COLLECTED_AMOUNT', 'GROSS_MARGIN');

-- CreateEnum
CREATE TYPE "CommissionTrigger" AS ENUM ('ON_CLOSE_WON', 'ON_INVOICE_SENT', 'ON_PAYMENT_RECEIVED');

-- CreateEnum
CREATE TYPE "CommissionRateType" AS ENUM ('FLAT_PERCENT', 'TIERED_PERCENT', 'FIXED_AMOUNT');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('DRAFT', 'ACCRUED', 'PENDING_APPROVAL', 'APPROVED', 'PAYABLE', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'CANCELLED', 'CLAWED_BACK');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "security_role" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "dataScope" VARCHAR(20) NOT NULL DEFAULT 'OWN',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "parentDepartmentId" UUID,
    "managerUserId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "employeeNumber" VARCHAR(30),
    "fullName" VARCHAR(150) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "passwordHash" TEXT,
    "avatarUrl" TEXT,
    "jobTitle" VARCHAR(150),
    "phone" VARCHAR(50),
    "departmentId" UUID,
    "managerUserId" UUID,
    "roleId" UUID NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "partnerId" UUID,
    "costRate" DECIMAL(18,2),
    "defaultBillingRate" DECIMAL(18,2),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "teamType" "TeamType" NOT NULL,
    "managerUserId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_member" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleInTeam" VARCHAR(100),
    "startDate" DATE,
    "endDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "currency" (
    "code" CHAR(3) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "symbol" VARCHAR(10),
    "exchangeRate" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "isBase" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currency_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "tax_rate" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "ratePercent" DECIMAL(8,4) NOT NULL,
    "taxType" "TaxType" NOT NULL,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_type" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "channel" VARCHAR(100),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" UUID NOT NULL,
    "campaignNumber" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "campaignTypeId" UUID NOT NULL,
    "parentCampaignId" UUID,
    "ownerUserId" UUID NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'PLANNED',
    "description" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "budgetAmount" DECIMAL(18,2),
    "actualCost" DECIMAL(18,2),
    "expectedLeads" INTEGER,
    "expectedRevenue" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_member" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "leadId" UUID,
    "contactId" UUID,
    "memberStatus" VARCHAR(50) NOT NULL DEFAULT 'TARGETED',
    "responded" BOOLEAN NOT NULL DEFAULT false,
    "responseDate" DATE,
    "opportunityId" UUID,
    "attributedRevenue" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead" (
    "id" UUID NOT NULL,
    "leadNumber" VARCHAR(30) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "companyName" VARCHAR(200),
    "jobTitle" VARCHAR(150),
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "whatsapp" VARCHAR(50),
    "industry" VARCHAR(100),
    "leadSource" VARCHAR(100),
    "campaignId" UUID,
    "referredByPartnerId" UUID,
    "ownerUserId" UUID NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "rating" "LeadRating",
    "estimatedValue" DECIMAL(18,2),
    "description" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "disqualifiedReason" VARCHAR(255),
    "convertedAt" TIMESTAMP(3),
    "convertedAccountId" UUID,
    "convertedContactId" UUID,
    "convertedOpportunityId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "accountNumber" VARCHAR(30) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "accountType" "AccountType" NOT NULL DEFAULT 'PROSPECT',
    "customerStatus" "CustomerStatus",
    "parentAccountId" UUID,
    "ownerUserId" UUID NOT NULL,
    "industry" VARCHAR(100),
    "website" VARCHAR(255),
    "mainPhone" VARCHAR(50),
    "employeeCount" INTEGER,
    "annualRevenue" DECIMAL(18,2),
    "taxNumberNtn" VARCHAR(50),
    "billingAddress" JSONB,
    "shippingAddress" JSONB,
    "creditLimit" DECIMAL(18,2),
    "paymentTermsDays" INTEGER,
    "customerHealth" "HealthStatus",
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact" (
    "id" UUID NOT NULL,
    "accountId" UUID,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(100) NOT NULL,
    "jobTitle" VARCHAR(150),
    "department" VARCHAR(100),
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "mobile" VARCHAR(50),
    "whatsapp" VARCHAR(50),
    "contactRole" VARCHAR(100),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "preferredChannel" "PreferredChannel",
    "communicationConsent" BOOLEAN NOT NULL DEFAULT false,
    "mailingAddress" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL,
    "productCode" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "category" VARCHAR(100),
    "productType" "ProductType" NOT NULL,
    "billingType" "BillingType" NOT NULL,
    "unitOfMeasure" VARCHAR(30),
    "standardPrice" DECIMAL(18,2),
    "standardCost" DECIMAL(18,2),
    "defaultTaxRateId" UUID,
    "commissionPercent" DECIMAL(8,4),
    "commissionable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity" (
    "id" UUID NOT NULL,
    "opportunityNumber" VARCHAR(30) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "accountId" UUID NOT NULL,
    "primaryContactId" UUID,
    "ownerUserId" UUID NOT NULL,
    "campaignId" UUID,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'DISCOVERY',
    "amount" DECIMAL(18,2) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL DEFAULT 'PKR',
    "probabilityPercent" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "expectedCloseDate" DATE NOT NULL,
    "actualCloseDate" DATE,
    "opportunityType" "OpportunityType" NOT NULL DEFAULT 'NEW',
    "leadSource" VARCHAR(100),
    "nextStep" VARCHAR(500),
    "description" TEXT,
    "lossReason" VARCHAR(255),
    "competitorName" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_product" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountPercent" DECIMAL(8,4),
    "taxRateId" UUID,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation" (
    "id" UUID NOT NULL,
    "quoteNumber" VARCHAR(30) NOT NULL,
    "opportunityId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "contactId" UUID,
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "quoteDate" DATE NOT NULL,
    "expiryDate" DATE NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "notes" TEXT,
    "termsAndConditions" TEXT,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_line" (
    "id" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "productId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountPercent" DECIMAL(8,4),
    "taxRateId" UUID,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" UUID NOT NULL,
    "contractNumber" VARCHAR(30) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "accountId" UUID NOT NULL,
    "opportunityId" UUID,
    "quotationId" UUID,
    "ownerUserId" UUID NOT NULL,
    "contractType" VARCHAR(100) NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "contractValue" DECIMAL(18,2) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL DEFAULT 'PKR',
    "billingFrequency" "BillingFrequency",
    "renewalType" "RenewalType",
    "noticePeriodDays" INTEGER,
    "signedDate" DATE,
    "signedDocumentId" UUID,
    "terminationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner" (
    "id" UUID NOT NULL,
    "partnerNumber" VARCHAR(30) NOT NULL,
    "displayName" VARCHAR(200) NOT NULL,
    "kind" "PartnerKind" NOT NULL,
    "accountId" UUID,
    "contactId" UUID,
    "partnerType" "PartnerType" NOT NULL,
    "tier" "PartnerTier" NOT NULL DEFAULT 'REGISTERED',
    "status" "PartnerStatus" NOT NULL DEFAULT 'PROSPECTIVE',
    "partnerManagerId" UUID,
    "territory" VARCHAR(150),
    "startDate" DATE,
    "agreementExpiryDate" DATE,
    "agreementDocumentId" UUID,
    "defaultCommissionPercent" DECIMAL(8,4),
    "commissionPlanId" UUID,
    "payoutCurrencyCode" CHAR(3) NOT NULL DEFAULT 'PKR',
    "taxNumber" VARCHAR(50),
    "withholdingTaxPercent" DECIMAL(8,4),
    "registrationProtectionDays" INTEGER,
    "bankDetails" JSONB,
    "email" VARCHAR(255),
    "phone" VARCHAR(50),
    "website" VARCHAR(255),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_contact" (
    "id" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "role" VARCHAR(100),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunity_partner" (
    "id" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "partnerId" UUID NOT NULL,
    "role" "PartnerRole" NOT NULL DEFAULT 'SOURCED',
    "revenueSharePercent" DECIMAL(8,4) NOT NULL DEFAULT 100,
    "commissionPercentOverride" DECIMAL(8,4),
    "commissionPlanId" UUID,
    "registeredAt" TIMESTAMP(3),
    "registrationExpiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opportunity_partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_plan" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "basis" "CommissionBasis" NOT NULL DEFAULT 'OPPORTUNITY_AMOUNT',
    "trigger" "CommissionTrigger" NOT NULL DEFAULT 'ON_PAYMENT_RECEIVED',
    "rateType" "CommissionRateType" NOT NULL DEFAULT 'FLAT_PERCENT',
    "flatPercent" DECIMAL(8,4),
    "fixedAmount" DECIMAL(18,2),
    "minimumDealAmount" DECIMAL(18,2),
    "maximumPayout" DECIMAL(18,2),
    "payoutDelayDays" INTEGER NOT NULL DEFAULT 0,
    "clawbackWindowDays" INTEGER,
    "effectiveFrom" DATE,
    "effectiveTo" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "commission_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_tier" (
    "id" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "fromAmount" DECIMAL(18,2) NOT NULL,
    "toAmount" DECIMAL(18,2),
    "ratePercent" DECIMAL(8,4) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_record" (
    "id" UUID NOT NULL,
    "commissionNumber" VARCHAR(30) NOT NULL,
    "partnerId" UUID NOT NULL,
    "opportunityId" UUID NOT NULL,
    "opportunityPartnerId" UUID,
    "planId" UUID,
    "invoiceId" UUID,
    "paymentId" UUID,
    "status" "CommissionStatus" NOT NULL DEFAULT 'ACCRUED',
    "basis" "CommissionBasis" NOT NULL,
    "basisAmount" DECIMAL(18,2) NOT NULL,
    "ratePercent" DECIMAL(8,4),
    "commissionAmount" DECIMAL(18,2) NOT NULL,
    "withholdingTaxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netPayableAmount" DECIMAL(18,2) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "earnedDate" DATE NOT NULL,
    "payableFromDate" DATE,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "payoutId" UUID,
    "paidAt" TIMESTAMP(3),
    "reversesRecordId" UUID,
    "calculationNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "commission_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_payout" (
    "id" UUID NOT NULL,
    "payoutNumber" VARCHAR(30) NOT NULL,
    "partnerId" UUID NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'DRAFT',
    "periodStart" DATE,
    "periodEnd" DATE,
    "grossAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "withholdingTaxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currencyCode" CHAR(3) NOT NULL,
    "paymentMethod" "PaymentMethod",
    "bankAccountId" UUID,
    "referenceNumber" VARCHAR(100),
    "paymentDate" DATE,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "commission_payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "parentCategoryId" UUID,
    "defaultTeamId" UUID,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_hours" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL,
    "weeklySchedule" JSONB NOT NULL,
    "holidayCalendar" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policy" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "priority" "Priority" NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL,
    "resolutionMinutes" INTEGER NOT NULL,
    "businessHoursId" UUID,
    "pauseOnCustomerWait" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_case" (
    "id" UUID NOT NULL,
    "caseNumber" VARCHAR(30) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "description" TEXT NOT NULL,
    "accountId" UUID NOT NULL,
    "contactId" UUID,
    "projectId" UUID,
    "contractId" UUID,
    "categoryId" UUID,
    "ownerUserId" UUID,
    "teamId" UUID,
    "slaPolicyId" UUID,
    "caseType" "CaseType" NOT NULL DEFAULT 'INCIDENT',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "CaseStatus" NOT NULL DEFAULT 'NEW',
    "source" "CaseSource" NOT NULL DEFAULT 'EMAIL',
    "firstResponseDueAt" TIMESTAMP(3),
    "firstRespondedAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "slaBreached" BOOLEAN NOT NULL DEFAULT false,
    "rootCause" TEXT,
    "resolution" TEXT,
    "satisfactionScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "support_case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_comment" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "authorUserId" UUID,
    "authorContactId" UUID,
    "commentType" "CaseCommentType" NOT NULL,
    "body" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "timeSpentMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_timer_event" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "eventType" "SlaEventType" NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(255),
    "businessMinutesDelta" INTEGER,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_timer_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_article" (
    "id" UUID NOT NULL,
    "articleNumber" VARCHAR(30) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "categoryId" UUID,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "authorUserId" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "visibility" "ArticleVisibility" NOT NULL DEFAULT 'INTERNAL',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "knowledge_article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project" (
    "id" UUID NOT NULL,
    "projectNumber" VARCHAR(30) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "accountId" UUID NOT NULL,
    "opportunityId" UUID,
    "contractId" UUID,
    "projectManagerId" UUID NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "health" "HealthStatus" NOT NULL DEFAULT 'GREEN',
    "billingType" "BillingType" NOT NULL,
    "startDate" DATE,
    "plannedEndDate" DATE,
    "actualEndDate" DATE,
    "contractValue" DECIMAL(18,2),
    "currencyCode" CHAR(3) NOT NULL DEFAULT 'PKR',
    "approvedHours" DECIMAL(18,2),
    "completionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_member" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectRole" VARCHAR(100) NOT NULL,
    "allocationPercent" DECIMAL(5,2),
    "startDate" DATE,
    "endDate" DATE,
    "billingRate" DECIMAL(18,2),
    "costRate" DECIMAL(18,2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_phase" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "ownerUserId" UUID,
    "plannedStart" DATE,
    "plannedEnd" DATE,
    "actualStart" DATE,
    "actualEnd" DATE,
    "status" "PhaseStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "budgetedHours" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_phase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestone" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "phaseId" UUID,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "ownerUserId" UUID,
    "dueDate" DATE NOT NULL,
    "completedDate" DATE,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "customerApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "customerApprovalDate" DATE,
    "billingTrigger" BOOLEAN NOT NULL DEFAULT false,
    "billingPercent" DECIMAL(8,4),
    "billingAmount" DECIMAL(18,2),
    "invoicedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_task" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "phaseId" UUID,
    "milestoneId" UUID,
    "parentTaskId" UUID,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "assignedUserId" UUID,
    "status" "TaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "startDate" DATE,
    "dueDate" DATE,
    "completedDate" DATE,
    "estimatedHours" DECIMAL(18,2),
    "completionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "acceptanceCriteria" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_log" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "projectId" UUID,
    "projectTaskId" UUID,
    "caseId" UUID,
    "workDate" DATE NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "description" TEXT NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "billingRate" DECIMAL(18,2),
    "costRate" DECIMAL(18,2),
    "approvalStatus" "TimeApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "invoiceLineId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "trainingType" "TrainingType" NOT NULL,
    "accountId" UUID,
    "projectId" UUID,
    "trainerUserId" UUID NOT NULL,
    "plannedStartAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "durationMinutes" INTEGER,
    "deliveryMethod" "DeliveryMethod" NOT NULL DEFAULT 'ONLINE',
    "location" VARCHAR(255),
    "status" "TrainingStatus" NOT NULL DEFAULT 'PLANNED',
    "meetingLink" TEXT,
    "materialDocumentId" UUID,
    "feedbackScore" DECIMAL(4,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_participant" (
    "id" UUID NOT NULL,
    "trainingId" UUID NOT NULL,
    "contactId" UUID,
    "userId" UUID,
    "registrationStatus" "RegistrationStatus" NOT NULL DEFAULT 'INVITED',
    "attendanceStatus" "AttendanceStatus",
    "completionStatus" "CompletionStatus",
    "assessmentScore" DECIMAL(5,2),
    "certificateIssued" BOOLEAN NOT NULL DEFAULT false,
    "feedback" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_risk" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "probability" "RiskLevel" NOT NULL,
    "impact" "RiskLevel" NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "mitigationPlan" TEXT,
    "ownerUserId" UUID NOT NULL,
    "targetDate" DATE,
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_issue" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "ownerUserId" UUID NOT NULL,
    "resolutionPlan" TEXT,
    "dueDate" DATE,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_request" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requestNumber" VARCHAR(30) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "requestedByContactId" UUID,
    "requestedByUserId" UUID,
    "description" TEXT NOT NULL,
    "businessReason" TEXT,
    "scopeImpact" TEXT,
    "costImpact" DECIMAL(18,2),
    "scheduleImpactDays" INTEGER,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "status" "ChangeRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "invoiceNumber" VARCHAR(30) NOT NULL,
    "accountId" UUID NOT NULL,
    "contactId" UUID,
    "projectId" UUID,
    "contractId" UUID,
    "milestoneId" UUID,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currencyCode" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "writeOffAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "productId" UUID,
    "projectId" UUID,
    "milestoneId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountPercent" DECIMAL(8,4),
    "taxRateId" UUID,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "revenueCategory" VARCHAR(100),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "paymentNumber" VARCHAR(30) NOT NULL,
    "accountId" UUID NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "unallocatedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currencyCode" CHAR(3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "bankAccountId" UUID,
    "referenceNumber" VARCHAR(100),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "clearedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocation" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "allocatedAmount" DECIMAL(18,2) NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocatedById" UUID NOT NULL,

    CONSTRAINT "payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_category" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "glCode" VARCHAR(50),
    "requiresReceipt" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense" (
    "id" UUID NOT NULL,
    "expenseNumber" VARCHAR(30) NOT NULL,
    "employeeUserId" UUID,
    "vendorAccountId" UUID,
    "projectId" UUID,
    "categoryId" UUID NOT NULL,
    "expenseDate" DATE NOT NULL,
    "description" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2),
    "currencyCode" CHAR(3) NOT NULL,
    "billableToCustomer" BOOLEAN NOT NULL DEFAULT false,
    "reimbursable" BOOLEAN NOT NULL DEFAULT true,
    "receiptDocumentId" UUID,
    "approvalStatus" "ExpenseApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentStatus" "ExpensePaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bill" (
    "id" UUID NOT NULL,
    "billNumber" VARCHAR(30) NOT NULL,
    "vendorAccountId" UUID NOT NULL,
    "vendorInvoiceNumber" VARCHAR(100),
    "projectId" UUID,
    "billDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "VendorBillStatus" NOT NULL DEFAULT 'DRAFT',
    "currencyCode" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vendor_bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_bill_line" (
    "id" UUID NOT NULL,
    "vendorBillId" UUID NOT NULL,
    "expenseCategoryId" UUID,
    "projectId" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitCost" DECIMAL(18,2) NOT NULL,
    "taxRateId" UUID,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_bill_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payment" (
    "id" UUID NOT NULL,
    "paymentNumber" VARCHAR(30) NOT NULL,
    "vendorAccountId" UUID NOT NULL,
    "paymentDate" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "bankAccountId" UUID,
    "referenceNumber" VARCHAR(100),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vendor_payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_payment_allocation" (
    "id" UUID NOT NULL,
    "vendorPaymentId" UUID NOT NULL,
    "vendorBillId" UUID NOT NULL,
    "allocatedAmount" DECIMAL(18,2) NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_payment_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_account" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "bankName" VARCHAR(150),
    "accountNumberMasked" VARCHAR(100),
    "iban" VARCHAR(100),
    "currencyCode" CHAR(3) NOT NULL,
    "accountType" "BankAccountType" NOT NULL DEFAULT 'BANK',
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_transaction" (
    "id" UUID NOT NULL,
    "transactionNumber" VARCHAR(30) NOT NULL,
    "transactionDate" DATE NOT NULL,
    "transactionType" "TransactionType" NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currencyCode" CHAR(3) NOT NULL,
    "bankAccountId" UUID,
    "sourceEntityType" VARCHAR(50),
    "sourceEntityId" UUID,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "reference" VARCHAR(255),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity" (
    "id" UUID NOT NULL,
    "activityType" "ActivityType" NOT NULL,
    "subject" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "ownerUserId" UUID NOT NULL,
    "contactId" UUID,
    "relatedEntityType" VARCHAR(50),
    "relatedEntityId" UUID,
    "startAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ActivityStatus" NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "location" VARCHAR(255),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email" (
    "id" UUID NOT NULL,
    "direction" "EmailDirection" NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "fromAddress" VARCHAR(255) NOT NULL,
    "toAddresses" JSONB NOT NULL,
    "ccAddresses" JSONB,
    "bodyHtml" TEXT,
    "bodyText" TEXT,
    "messageId" VARCHAR(500),
    "threadId" VARCHAR(500),
    "relatedEntityType" VARCHAR(50),
    "relatedEntityId" UUID,
    "sentReceivedAt" TIMESTAMP(3) NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'RECEIVED',
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "note" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255),
    "content" TEXT NOT NULL,
    "relatedEntityType" VARCHAR(50) NOT NULL,
    "relatedEntityId" UUID NOT NULL,
    "visibility" "NoteVisibility" NOT NULL DEFAULT 'TEAM',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" UUID NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL,
    "category" VARCHAR(100),
    "versionNumber" INTEGER NOT NULL DEFAULT 1,
    "relatedEntityType" VARCHAR(50) NOT NULL,
    "relatedEntityId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "confidential" BOOLEAN NOT NULL DEFAULT false,
    "checksum" VARCHAR(128),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_request" (
    "id" UUID NOT NULL,
    "approvalType" VARCHAR(100) NOT NULL,
    "relatedEntityType" VARCHAR(50) NOT NULL,
    "relatedEntityId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "currentApproverId" UUID,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_step" (
    "id" UUID NOT NULL,
    "approvalRequestId" UUID NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "approverUserId" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_step_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_history" (
    "id" UUID NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "entityId" UUID NOT NULL,
    "fieldName" VARCHAR(100) NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedById" UUID,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(50),

    CONSTRAINT "audit_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_sequence" (
    "id" UUID NOT NULL,
    "entityType" VARCHAR(50) NOT NULL,
    "prefix" VARCHAR(20) NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,
    "paddingLength" INTEGER NOT NULL DEFAULT 5,
    "includeYear" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_sequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "security_role_name_key" ON "security_role"("name");

-- CreateIndex
CREATE INDEX "department_parentDepartmentId_idx" ON "department"("parentDepartmentId");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_employeeNumber_key" ON "app_user"("employeeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_partnerId_key" ON "app_user"("partnerId");

-- CreateIndex
CREATE INDEX "app_user_departmentId_idx" ON "app_user"("departmentId");

-- CreateIndex
CREATE INDEX "app_user_managerUserId_idx" ON "app_user"("managerUserId");

-- CreateIndex
CREATE INDEX "app_user_roleId_idx" ON "app_user"("roleId");

-- CreateIndex
CREATE INDEX "app_user_status_idx" ON "app_user"("status");

-- CreateIndex
CREATE INDEX "team_teamType_idx" ON "team"("teamType");

-- CreateIndex
CREATE INDEX "team_member_userId_idx" ON "team_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_member_teamId_userId_key" ON "team_member"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_campaignNumber_key" ON "campaign"("campaignNumber");

-- CreateIndex
CREATE INDEX "campaign_status_idx" ON "campaign"("status");

-- CreateIndex
CREATE INDEX "campaign_ownerUserId_idx" ON "campaign"("ownerUserId");

-- CreateIndex
CREATE INDEX "campaign_campaignTypeId_idx" ON "campaign"("campaignTypeId");

-- CreateIndex
CREATE INDEX "campaign_member_campaignId_idx" ON "campaign_member"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_member_campaignId_leadId_key" ON "campaign_member"("campaignId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_member_campaignId_contactId_key" ON "campaign_member"("campaignId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_leadNumber_key" ON "lead"("leadNumber");

-- CreateIndex
CREATE INDEX "lead_status_idx" ON "lead"("status");

-- CreateIndex
CREATE INDEX "lead_ownerUserId_idx" ON "lead"("ownerUserId");

-- CreateIndex
CREATE INDEX "lead_campaignId_idx" ON "lead"("campaignId");

-- CreateIndex
CREATE INDEX "lead_email_idx" ON "lead"("email");

-- CreateIndex
CREATE INDEX "lead_referredByPartnerId_idx" ON "lead"("referredByPartnerId");

-- CreateIndex
CREATE UNIQUE INDEX "account_accountNumber_key" ON "account"("accountNumber");

-- CreateIndex
CREATE INDEX "account_accountType_idx" ON "account"("accountType");

-- CreateIndex
CREATE INDEX "account_ownerUserId_idx" ON "account"("ownerUserId");

-- CreateIndex
CREATE INDEX "account_name_idx" ON "account"("name");

-- CreateIndex
CREATE INDEX "contact_accountId_idx" ON "contact"("accountId");

-- CreateIndex
CREATE INDEX "contact_email_idx" ON "contact"("email");

-- CreateIndex
CREATE UNIQUE INDEX "product_productCode_key" ON "product"("productCode");

-- CreateIndex
CREATE INDEX "product_productType_idx" ON "product"("productType");

-- CreateIndex
CREATE INDEX "product_active_idx" ON "product"("active");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_opportunityNumber_key" ON "opportunity"("opportunityNumber");

-- CreateIndex
CREATE INDEX "opportunity_stage_idx" ON "opportunity"("stage");

-- CreateIndex
CREATE INDEX "opportunity_accountId_idx" ON "opportunity"("accountId");

-- CreateIndex
CREATE INDEX "opportunity_ownerUserId_idx" ON "opportunity"("ownerUserId");

-- CreateIndex
CREATE INDEX "opportunity_expectedCloseDate_idx" ON "opportunity"("expectedCloseDate");

-- CreateIndex
CREATE INDEX "opportunity_product_opportunityId_idx" ON "opportunity_product"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_quoteNumber_key" ON "quotation"("quoteNumber");

-- CreateIndex
CREATE INDEX "quotation_status_idx" ON "quotation"("status");

-- CreateIndex
CREATE INDEX "quotation_accountId_idx" ON "quotation"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_opportunityId_versionNumber_key" ON "quotation"("opportunityId", "versionNumber");

-- CreateIndex
CREATE INDEX "quote_line_quotationId_idx" ON "quote_line"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "contract_contractNumber_key" ON "contract"("contractNumber");

-- CreateIndex
CREATE INDEX "contract_status_idx" ON "contract"("status");

-- CreateIndex
CREATE INDEX "contract_accountId_idx" ON "contract"("accountId");

-- CreateIndex
CREATE INDEX "contract_endDate_idx" ON "contract"("endDate");

-- CreateIndex
CREATE UNIQUE INDEX "partner_partnerNumber_key" ON "partner"("partnerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "partner_accountId_key" ON "partner"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_contactId_key" ON "partner"("contactId");

-- CreateIndex
CREATE INDEX "partner_status_idx" ON "partner"("status");

-- CreateIndex
CREATE INDEX "partner_partnerType_idx" ON "partner"("partnerType");

-- CreateIndex
CREATE INDEX "partner_kind_idx" ON "partner"("kind");

-- CreateIndex
CREATE INDEX "partner_partnerManagerId_idx" ON "partner"("partnerManagerId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_contact_partnerId_contactId_key" ON "partner_contact"("partnerId", "contactId");

-- CreateIndex
CREATE INDEX "opportunity_partner_partnerId_idx" ON "opportunity_partner"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "opportunity_partner_opportunityId_partnerId_role_key" ON "opportunity_partner"("opportunityId", "partnerId", "role");

-- CreateIndex
CREATE INDEX "commission_tier_planId_idx" ON "commission_tier"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_record_commissionNumber_key" ON "commission_record"("commissionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "commission_record_reversesRecordId_key" ON "commission_record"("reversesRecordId");

-- CreateIndex
CREATE INDEX "commission_record_partnerId_idx" ON "commission_record"("partnerId");

-- CreateIndex
CREATE INDEX "commission_record_opportunityId_idx" ON "commission_record"("opportunityId");

-- CreateIndex
CREATE INDEX "commission_record_status_idx" ON "commission_record"("status");

-- CreateIndex
CREATE INDEX "commission_record_earnedDate_idx" ON "commission_record"("earnedDate");

-- CreateIndex
CREATE UNIQUE INDEX "commission_record_opportunityPartnerId_invoiceId_paymentId_key" ON "commission_record"("opportunityPartnerId", "invoiceId", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_payout_payoutNumber_key" ON "commission_payout"("payoutNumber");

-- CreateIndex
CREATE INDEX "commission_payout_partnerId_idx" ON "commission_payout"("partnerId");

-- CreateIndex
CREATE INDEX "commission_payout_status_idx" ON "commission_payout"("status");

-- CreateIndex
CREATE UNIQUE INDEX "support_case_caseNumber_key" ON "support_case"("caseNumber");

-- CreateIndex
CREATE INDEX "support_case_status_idx" ON "support_case"("status");

-- CreateIndex
CREATE INDEX "support_case_accountId_idx" ON "support_case"("accountId");

-- CreateIndex
CREATE INDEX "support_case_ownerUserId_idx" ON "support_case"("ownerUserId");

-- CreateIndex
CREATE INDEX "support_case_teamId_idx" ON "support_case"("teamId");

-- CreateIndex
CREATE INDEX "support_case_priority_idx" ON "support_case"("priority");

-- CreateIndex
CREATE INDEX "support_case_resolutionDueAt_idx" ON "support_case"("resolutionDueAt");

-- CreateIndex
CREATE INDEX "case_comment_caseId_idx" ON "case_comment"("caseId");

-- CreateIndex
CREATE INDEX "sla_timer_event_caseId_idx" ON "sla_timer_event"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_article_articleNumber_key" ON "knowledge_article"("articleNumber");

-- CreateIndex
CREATE INDEX "knowledge_article_status_idx" ON "knowledge_article"("status");

-- CreateIndex
CREATE INDEX "knowledge_article_categoryId_idx" ON "knowledge_article"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "project_projectNumber_key" ON "project"("projectNumber");

-- CreateIndex
CREATE INDEX "project_status_idx" ON "project"("status");

-- CreateIndex
CREATE INDEX "project_accountId_idx" ON "project"("accountId");

-- CreateIndex
CREATE INDEX "project_projectManagerId_idx" ON "project"("projectManagerId");

-- CreateIndex
CREATE INDEX "project_member_userId_idx" ON "project_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_member_projectId_userId_key" ON "project_member"("projectId", "userId");

-- CreateIndex
CREATE INDEX "project_phase_projectId_idx" ON "project_phase"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_phase_projectId_sequenceNumber_key" ON "project_phase"("projectId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "milestone_projectId_idx" ON "milestone"("projectId");

-- CreateIndex
CREATE INDEX "milestone_dueDate_idx" ON "milestone"("dueDate");

-- CreateIndex
CREATE INDEX "project_task_projectId_idx" ON "project_task"("projectId");

-- CreateIndex
CREATE INDEX "project_task_assignedUserId_idx" ON "project_task"("assignedUserId");

-- CreateIndex
CREATE INDEX "project_task_status_idx" ON "project_task"("status");

-- CreateIndex
CREATE INDEX "project_task_dueDate_idx" ON "project_task"("dueDate");

-- CreateIndex
CREATE INDEX "time_log_userId_workDate_idx" ON "time_log"("userId", "workDate");

-- CreateIndex
CREATE INDEX "time_log_projectId_idx" ON "time_log"("projectId");

-- CreateIndex
CREATE INDEX "time_log_approvalStatus_idx" ON "time_log"("approvalStatus");

-- CreateIndex
CREATE INDEX "training_projectId_idx" ON "training"("projectId");

-- CreateIndex
CREATE INDEX "training_status_idx" ON "training"("status");

-- CreateIndex
CREATE INDEX "training_participant_trainingId_idx" ON "training_participant"("trainingId");

-- CreateIndex
CREATE INDEX "project_risk_projectId_idx" ON "project_risk"("projectId");

-- CreateIndex
CREATE INDEX "project_issue_projectId_idx" ON "project_issue"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "change_request_requestNumber_key" ON "change_request"("requestNumber");

-- CreateIndex
CREATE INDEX "change_request_projectId_idx" ON "change_request"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_invoiceNumber_key" ON "invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoice_status_idx" ON "invoice"("status");

-- CreateIndex
CREATE INDEX "invoice_accountId_idx" ON "invoice"("accountId");

-- CreateIndex
CREATE INDEX "invoice_dueDate_idx" ON "invoice"("dueDate");

-- CreateIndex
CREATE INDEX "invoice_line_invoiceId_idx" ON "invoice_line"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_paymentNumber_key" ON "payment"("paymentNumber");

-- CreateIndex
CREATE INDEX "payment_accountId_idx" ON "payment"("accountId");

-- CreateIndex
CREATE INDEX "payment_status_idx" ON "payment"("status");

-- CreateIndex
CREATE INDEX "payment_paymentDate_idx" ON "payment"("paymentDate");

-- CreateIndex
CREATE INDEX "payment_allocation_invoiceId_idx" ON "payment_allocation"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocation_paymentId_invoiceId_key" ON "payment_allocation"("paymentId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_expenseNumber_key" ON "expense"("expenseNumber");

-- CreateIndex
CREATE INDEX "expense_approvalStatus_idx" ON "expense"("approvalStatus");

-- CreateIndex
CREATE INDEX "expense_projectId_idx" ON "expense"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_bill_billNumber_key" ON "vendor_bill"("billNumber");

-- CreateIndex
CREATE INDEX "vendor_bill_status_idx" ON "vendor_bill"("status");

-- CreateIndex
CREATE INDEX "vendor_bill_vendorAccountId_idx" ON "vendor_bill"("vendorAccountId");

-- CreateIndex
CREATE INDEX "vendor_bill_dueDate_idx" ON "vendor_bill"("dueDate");

-- CreateIndex
CREATE INDEX "vendor_bill_line_vendorBillId_idx" ON "vendor_bill_line"("vendorBillId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payment_paymentNumber_key" ON "vendor_payment"("paymentNumber");

-- CreateIndex
CREATE INDEX "vendor_payment_vendorAccountId_idx" ON "vendor_payment"("vendorAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payment_allocation_vendorPaymentId_vendorBillId_key" ON "vendor_payment_allocation"("vendorPaymentId", "vendorBillId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transaction_transactionNumber_key" ON "financial_transaction"("transactionNumber");

-- CreateIndex
CREATE INDEX "financial_transaction_transactionDate_idx" ON "financial_transaction"("transactionDate");

-- CreateIndex
CREATE INDEX "financial_transaction_sourceEntityType_sourceEntityId_idx" ON "financial_transaction"("sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "activity_ownerUserId_status_idx" ON "activity"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "activity_relatedEntityType_relatedEntityId_idx" ON "activity"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "activity_dueAt_idx" ON "activity"("dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_messageId_key" ON "email"("messageId");

-- CreateIndex
CREATE INDEX "email_relatedEntityType_relatedEntityId_idx" ON "email"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "email_threadId_idx" ON "email"("threadId");

-- CreateIndex
CREATE INDEX "note_relatedEntityType_relatedEntityId_idx" ON "note"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "document_relatedEntityType_relatedEntityId_idx" ON "document"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "approval_request_relatedEntityType_relatedEntityId_idx" ON "approval_request"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "approval_request_status_currentApproverId_idx" ON "approval_request"("status", "currentApproverId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_step_approvalRequestId_stepNumber_key" ON "approval_step"("approvalRequestId", "stepNumber");

-- CreateIndex
CREATE INDEX "audit_history_entityType_entityId_idx" ON "audit_history"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_history_changedAt_idx" ON "audit_history"("changedAt");

-- CreateIndex
CREATE UNIQUE INDEX "number_sequence_entityType_key" ON "number_sequence"("entityType");

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_parentDepartmentId_fkey" FOREIGN KEY ("parentDepartmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department" ADD CONSTRAINT "department_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "security_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team" ADD CONSTRAINT "team_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_member" ADD CONSTRAINT "team_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_campaignTypeId_fkey" FOREIGN KEY ("campaignTypeId") REFERENCES "campaign_type"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_parentCampaignId_fkey" FOREIGN KEY ("parentCampaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_member" ADD CONSTRAINT "campaign_member_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_member" ADD CONSTRAINT "campaign_member_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_member" ADD CONSTRAINT "campaign_member_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_member" ADD CONSTRAINT "campaign_member_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_referredByPartnerId_fkey" FOREIGN KEY ("referredByPartnerId") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_convertedAccountId_fkey" FOREIGN KEY ("convertedAccountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_convertedContactId_fkey" FOREIGN KEY ("convertedContactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead" ADD CONSTRAINT "lead_convertedOpportunityId_fkey" FOREIGN KEY ("convertedOpportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_defaultTaxRateId_fkey" FOREIGN KEY ("defaultTaxRateId") REFERENCES "tax_rate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_product" ADD CONSTRAINT "opportunity_product_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_product" ADD CONSTRAINT "opportunity_product_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_product" ADD CONSTRAINT "opportunity_product_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation" ADD CONSTRAINT "quotation_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_line" ADD CONSTRAINT "quote_line_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner" ADD CONSTRAINT "partner_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner" ADD CONSTRAINT "partner_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner" ADD CONSTRAINT "partner_partnerManagerId_fkey" FOREIGN KEY ("partnerManagerId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner" ADD CONSTRAINT "partner_commissionPlanId_fkey" FOREIGN KEY ("commissionPlanId") REFERENCES "commission_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_contact" ADD CONSTRAINT "partner_contact_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_contact" ADD CONSTRAINT "partner_contact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_partner" ADD CONSTRAINT "opportunity_partner_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_partner" ADD CONSTRAINT "opportunity_partner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunity_partner" ADD CONSTRAINT "opportunity_partner_commissionPlanId_fkey" FOREIGN KEY ("commissionPlanId") REFERENCES "commission_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_tier" ADD CONSTRAINT "commission_tier_planId_fkey" FOREIGN KEY ("planId") REFERENCES "commission_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_opportunityPartnerId_fkey" FOREIGN KEY ("opportunityPartnerId") REFERENCES "opportunity_partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_planId_fkey" FOREIGN KEY ("planId") REFERENCES "commission_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "commission_payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_record" ADD CONSTRAINT "commission_record_reversesRecordId_fkey" FOREIGN KEY ("reversesRecordId") REFERENCES "commission_record"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payout" ADD CONSTRAINT "commission_payout_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payout" ADD CONSTRAINT "commission_payout_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payout" ADD CONSTRAINT "commission_payout_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_payout" ADD CONSTRAINT "commission_payout_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_category" ADD CONSTRAINT "case_category_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "case_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_category" ADD CONSTRAINT "case_category_defaultTeamId_fkey" FOREIGN KEY ("defaultTeamId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_businessHoursId_fkey" FOREIGN KEY ("businessHoursId") REFERENCES "business_hours"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "case_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case" ADD CONSTRAINT "support_case_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "sla_policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_comment" ADD CONSTRAINT "case_comment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "support_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_comment" ADD CONSTRAINT "case_comment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_comment" ADD CONSTRAINT "case_comment_authorContactId_fkey" FOREIGN KEY ("authorContactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_timer_event" ADD CONSTRAINT "sla_timer_event_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "support_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_timer_event" ADD CONSTRAINT "sla_timer_event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_article" ADD CONSTRAINT "knowledge_article_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "case_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_article" ADD CONSTRAINT "knowledge_article_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_phase" ADD CONSTRAINT "project_phase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_phase" ADD CONSTRAINT "project_phase_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "project_phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestone" ADD CONSTRAINT "milestone_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "project_phase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_parentTaskId_fkey" FOREIGN KEY ("parentTaskId") REFERENCES "project_task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_task" ADD CONSTRAINT "project_task_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_projectTaskId_fkey" FOREIGN KEY ("projectTaskId") REFERENCES "project_task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "support_case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_log" ADD CONSTRAINT "time_log_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "invoice_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training" ADD CONSTRAINT "training_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training" ADD CONSTRAINT "training_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training" ADD CONSTRAINT "training_trainerUserId_fkey" FOREIGN KEY ("trainerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_participant" ADD CONSTRAINT "training_participant_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_participant" ADD CONSTRAINT "training_participant_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_participant" ADD CONSTRAINT "training_participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risk" ADD CONSTRAINT "project_risk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_risk" ADD CONSTRAINT "project_risk_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_issue" ADD CONSTRAINT "project_issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_issue" ADD CONSTRAINT "project_issue_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_requestedByContactId_fkey" FOREIGN KEY ("requestedByContactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_request" ADD CONSTRAINT "change_request_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line" ADD CONSTRAINT "invoice_line_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocation" ADD CONSTRAINT "payment_allocation_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_employeeUserId_fkey" FOREIGN KEY ("employeeUserId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "expense_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense" ADD CONSTRAINT "expense_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill" ADD CONSTRAINT "vendor_bill_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill" ADD CONSTRAINT "vendor_bill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill" ADD CONSTRAINT "vendor_bill_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_line" ADD CONSTRAINT "vendor_bill_line_vendorBillId_fkey" FOREIGN KEY ("vendorBillId") REFERENCES "vendor_bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_line" ADD CONSTRAINT "vendor_bill_line_expenseCategoryId_fkey" FOREIGN KEY ("expenseCategoryId") REFERENCES "expense_category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_line" ADD CONSTRAINT "vendor_bill_line_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_bill_line" ADD CONSTRAINT "vendor_bill_line_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment" ADD CONSTRAINT "vendor_payment_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment" ADD CONSTRAINT "vendor_payment_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment" ADD CONSTRAINT "vendor_payment_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocation" ADD CONSTRAINT "vendor_payment_allocation_vendorPaymentId_fkey" FOREIGN KEY ("vendorPaymentId") REFERENCES "vendor_payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payment_allocation" ADD CONSTRAINT "vendor_payment_allocation_vendorBillId_fkey" FOREIGN KEY ("vendorBillId") REFERENCES "vendor_bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_account" ADD CONSTRAINT "bank_account_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transaction" ADD CONSTRAINT "financial_transaction_currencyCode_fkey" FOREIGN KEY ("currencyCode") REFERENCES "currency"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_transaction" ADD CONSTRAINT "financial_transaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity" ADD CONSTRAINT "activity_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "note" ADD CONSTRAINT "note_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_request" ADD CONSTRAINT "approval_request_currentApproverId_fkey" FOREIGN KEY ("currentApproverId") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_step" ADD CONSTRAINT "approval_step_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_history" ADD CONSTRAINT "audit_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ============ 001_scope_helpers ============
-- Row-level security: scope helper functions.
--
-- These reproduce src/lib/authz.ts scopeFilter() inside the database, so the
-- same rules hold no matter which client issues the query.
--
-- Design note (see docs/SUPABASE-MIGRATION.md): membership is read from the
-- tables on every check rather than from JWT claims. Claims are faster but go
-- stale for the life of a session, so a user moved between teams would keep
-- their old visibility for up to 8 hours. Today's behaviour is immediate, and
-- silently regressing that in an access-control path is not worth the lookup.
--
-- All functions are STABLE (not IMMUTABLE): results depend on table contents
-- within a statement, which lets Postgres cache them per-statement.

-- The current app user's id. Set per request by the application via
--   SELECT set_config('app.user_id', $1, true)
-- inside the same transaction as the query. Returns NULL when unset, and every
-- policy below denies on NULL, so an unconfigured connection sees nothing.
create or replace function app_current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

-- The signed-in user's data scope: OWN | TEAM | DEPARTMENT | ALL.
-- Mirrors SecurityRole.dataScope. Inactive or soft-deleted users resolve to
-- NULL, which denies everywhere -- matching requireUser()'s "Account is not
-- active." refusal.
create or replace function app_current_scope()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r."dataScope"
  from app_user u
  join security_role r on r.id = u."roleId"
  where u.id = app_current_user_id()
    and u.status = 'ACTIVE'
    and u."deletedAt" is null;
$$;

-- The partner this user acts for, or NULL for internal staff.
-- Per the schema comment on User.partnerId, a non-null value is what makes a
-- user external. This is the discriminator between the two policy families.
create or replace function app_current_partner_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u."partnerId"
  from app_user u
  where u.id = app_current_user_id()
    and u.status = 'ACTIVE'
    and u."deletedAt" is null;
$$;

-- The set of owner-user-ids the current user may see, for internal staff.
--
-- Deliberately mirrors scopeFilter()'s fallbacks: a TEAM user on no team, and a
-- DEPARTMENT user with no department, both collapse to OWN rather than opening
-- up. Those two fallbacks are asserted by test/authz-scope.test.ts.
create or replace function app_visible_owner_ids()
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := app_current_user_id();
  v_scope   text := app_current_scope();
  v_dept    uuid;
begin
  if v_user_id is null or v_scope is null then
    return;  -- no rows: unknown or inactive user sees nothing
  end if;

  if v_scope = 'OWN' then
    return query select v_user_id;
    return;
  end if;

  if v_scope = 'TEAM' then
    -- Self, plus everyone sharing any team with us. If we are on no team this
    -- yields just self, matching the application fallback.
    return query
      select distinct m2."userId"
      from team_member m1
      join team_member m2 on m2."teamId" = m1."teamId"
      where m1."userId" = v_user_id
      union
      select v_user_id;
    return;
  end if;

  if v_scope = 'DEPARTMENT' then
    select u."departmentId" into v_dept from app_user u where u.id = v_user_id;

    if v_dept is null then
      return query select v_user_id;  -- fallback to OWN
    else
      return query
        select u.id from app_user u where u."departmentId" = v_dept;
    end if;
    return;
  end if;

  -- 'ALL' is not handled here. Callers must check app_current_scope() = 'ALL'
  -- separately, because "unrestricted" cannot be expressed as a finite id set.
  return;
end;
$$;

-- The opportunity ids the current partner is linked to.
--
-- MUST be SECURITY DEFINER. The external policy on `opportunity` needs to look
-- at `opportunity_partner`, and that table's own policies look back at
-- `opportunity` -- a cycle Postgres reports as "infinite recursion detected in
-- policy for relation". Resolving the link set inside a definer function
-- bypasses RLS for this lookup and breaks the loop.
--
-- Caught by the probe in docs/SUPABASE-MIGRATION.md: the pilot passed only
-- because opportunity_partner had no RLS yet.
create or replace function app_partner_opportunity_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select op."opportunityId"
  from opportunity_partner op
  where app_current_partner_id() is not null
    and op."partnerId" = app_current_partner_id();
$$;

-- The commission-visible opportunity ids for internal staff, resolved without
-- re-entering the `opportunity` policies. Same recursion reason as above.
create or replace function app_internal_visible_opportunity_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select o.id
  from opportunity o
  where o."ownerUserId" in (select app_visible_owner_ids());
$$;

-- True when the current user is internal staff (not a partner portal login).
create or replace function app_is_internal()
returns boolean
language sql
stable
as $$
  select app_current_user_id() is not null
     and app_current_partner_id() is null
     and app_current_scope() is not null;
$$;

-- Indexes supporting the per-check lookups above.
create index if not exists team_member_user_idx on team_member ("userId");
create index if not exists team_member_team_idx on team_member ("teamId");
create index if not exists app_user_department_idx on app_user ("departmentId");


-- ============ 002_policies_pilot ============
-- Row-level security: pilot policies.
--
-- Three representative tables, per docs/SUPABASE-MIGRATION.md step 3:
--   opportunity        -- internal, ownerUserId-scoped (OWN/TEAM/DEPT/ALL)
--   commission_record  -- external, partnerId-isolated (portal path)
--   account            -- internal, second table to prove the pattern repeats
--
-- The remaining tables are NOT converted yet. Roll them out only once the
-- characterization tests pass against these three with the application-level
-- filter removed.
--
-- Two policy families, discriminated by app_current_partner_id():
--   internal  (partnerId IS NULL)     -> dataScope over ownerUserId
--   external  (partnerId IS NOT NULL) -> that partner's rows only
--
-- The failure that matters is an external user matching an internal policy.
-- Postgres ORs multiple permissive policies together, so each family's
-- predicate must explicitly exclude the other -- app_is_internal() in the
-- internal policies is load-bearing, not decorative.

-- ---------------------------------------------------------------- opportunity
alter table opportunity enable row level security;
alter table opportunity force row level security;

drop policy if exists opportunity_internal_read on opportunity;
create policy opportunity_internal_read on opportunity
  for select
  using (
    app_is_internal()
    and (
      app_current_scope() = 'ALL'
      or "ownerUserId" in (select app_visible_owner_ids())
    )
  );

-- External users reach a deal only through their own partner link.
drop policy if exists opportunity_external_read on opportunity;
create policy opportunity_external_read on opportunity
  for select
  using (
    app_current_partner_id() is not null
    -- via SECURITY DEFINER helper, not a direct read of opportunity_partner:
    -- that table's policies reference opportunity, which would recurse.
    and id in (select app_partner_opportunity_ids())
  );

-- ---------------------------------------------------------- commission_record
alter table commission_record enable row level security;
alter table commission_record force row level security;

drop policy if exists commission_record_internal_read on commission_record;
create policy commission_record_internal_read on commission_record
  for select
  using (
    app_is_internal()
    and (
      app_current_scope() = 'ALL'
      -- definer helper, same recursion reason as the opportunity policy
      or "opportunityId" in (select app_internal_visible_opportunity_ids())
    )
  );

-- The portal isolation rule: own partner's commission, nothing else.
drop policy if exists commission_record_external_read on commission_record;
create policy commission_record_external_read on commission_record
  for select
  using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
  );

-- -------------------------------------------------------------------- account
alter table account enable row level security;
alter table account force row level security;

drop policy if exists account_internal_read on account;
create policy account_internal_read on account
  for select
  using (
    app_is_internal()
    and (
      app_current_scope() = 'ALL'
      or "ownerUserId" in (select app_visible_owner_ids())
    )
  );

-- No external policy on account: partners have no account visibility today.
-- Absent a permissive policy, external users see zero rows here, which is the
-- intended default.


-- ============ 003_policies_rollout ============
-- Row-level security: full rollout.
--
-- Extends the pilot (002) to every remaining scoped table. Depends on the
-- helpers in 001. Apply in order: 001, 002, 003.
--
-- SELECT policies only. Writes still go through the application's
-- requirePermission() checks; write policies are tracked as follow-up in
-- docs/SUPABASE-MIGRATION.md.
--
-- Two families, discriminated by app_current_partner_id():
--   internal (partnerId IS NULL)      -> dataScope over ownerUserId
--   external (partnerId IS NOT NULL)  -> that partner's rows only
--
-- app_is_internal() in every internal policy is load-bearing: Postgres ORs
-- permissive policies together, so without it an external user could match an
-- internal policy and escape partner isolation.

-- ============================================================== internal tables
-- Same shape as opportunity/account in 002: owner-scoped, no external access.

do $$
declare
  t text;
  owner_tables text[] := array[
    'activity', 'campaign', 'contract', 'lead', 'milestone',
    'project_issue', 'project_phase', 'project_risk', 'support_case'
  ];
begin
  foreach t in array owner_tables loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_internal_read', t);
    execute format($f$
      create policy %I on %I
        for select
        using (
          app_is_internal()
          and (
            app_current_scope() = 'ALL'
            or "ownerUserId" in (select app_visible_owner_ids())
          )
        )
    $f$, t || '_internal_read', t);
  end loop;
end $$;

-- ============================================================== partner tables

-- ------------------------------------------------------- opportunity_partner
-- The join table linking deals to partners. An external user sees only their
-- own links; internal users see links on deals they can already see.
alter table opportunity_partner enable row level security;
alter table opportunity_partner force row level security;

drop policy if exists opportunity_partner_internal_read on opportunity_partner;
create policy opportunity_partner_internal_read on opportunity_partner
  for select
  using (
    app_is_internal()
    and (
      app_current_scope() = 'ALL'
      -- definer helper: reading `opportunity` directly here recurses, because
      -- opportunity's external policy reads this table.
      or "opportunityId" in (select app_internal_visible_opportunity_ids())
    )
  );

drop policy if exists opportunity_partner_external_read on opportunity_partner;
create policy opportunity_partner_external_read on opportunity_partner
  for select
  using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
  );

-- --------------------------------------------------------- commission_payout
alter table commission_payout enable row level security;
alter table commission_payout force row level security;

drop policy if exists commission_payout_internal_read on commission_payout;
create policy commission_payout_internal_read on commission_payout
  for select
  using (app_is_internal());

drop policy if exists commission_payout_external_read on commission_payout;
create policy commission_payout_external_read on commission_payout
  for select
  using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
  );

-- ----------------------------------------------------------- partner_contact
alter table partner_contact enable row level security;
alter table partner_contact force row level security;

drop policy if exists partner_contact_internal_read on partner_contact;
create policy partner_contact_internal_read on partner_contact
  for select
  using (app_is_internal());

drop policy if exists partner_contact_external_read on partner_contact;
create policy partner_contact_external_read on partner_contact
  for select
  using (
    app_current_partner_id() is not null
    and "partnerId" = app_current_partner_id()
  );

-- ------------------------------------------------------------------- partner
-- The partner record itself: an external user sees only their own.
alter table partner enable row level security;
alter table partner force row level security;

drop policy if exists partner_internal_read on partner;
create policy partner_internal_read on partner
  for select
  using (app_is_internal());

drop policy if exists partner_external_read on partner;
create policy partner_external_read on partner
  for select
  using (
    app_current_partner_id() is not null
    and id = app_current_partner_id()
  );

-- ------------------------------------------------------------------ app_user
-- Directory data. Internal staff may resolve colleagues (names appear on owned
-- records). An external user may see only their own row -- never the staff
-- directory, and never other partners' portal users.
alter table app_user enable row level security;
alter table app_user force row level security;

drop policy if exists app_user_internal_read on app_user;
create policy app_user_internal_read on app_user
  for select
  using (app_is_internal());

drop policy if exists app_user_self_read on app_user;
create policy app_user_self_read on app_user
  for select
  using (id = app_current_user_id());

-- NOTE: app_user is read by the helper functions themselves. Those are
-- SECURITY DEFINER and therefore bypass these policies, so enabling RLS here
-- does not create a recursive lookup. Verified by the probe in
-- docs/SUPABASE-MIGRATION.md -- without SECURITY DEFINER this deadlocks into
-- every user seeing zero rows.


-- ============ 009_fn_numbering ============
-- Human-readable record numbers, ported from src/lib/numbering.ts.
--
-- Must live in the database once writes move to supabase-js: the TypeScript
-- version relies on running inside a Prisma transaction with the surrounding
-- insert, and supabase-js cannot provide that.
--
-- entity_type matches NumberSequence.entityType exactly — the values in
-- SEQUENCES in src/lib/numbering.ts, e.g. 'CommissionRecord', not 'COMMISSION'.

create or replace function next_sequence_number(p_entity_type text)
returns text
language plpgsql
as $$
declare
  v_prefix   text;
  v_padding  integer;
  v_year     boolean;
  v_value    integer;
begin
  -- UPDATE ... RETURNING takes the row lock and increments in one statement,
  -- so concurrent callers cannot collide on a number. Mirrors the atomic
  -- increment in the Prisma version.
  update number_sequence
  set "nextValue" = "nextValue" + 1
  where "entityType" = p_entity_type
  returning "nextValue" - 1, prefix, "paddingLength", "includeYear"
  into v_value, v_prefix, v_padding, v_year;

  if not found then
    raise exception 'No number sequence configured for "%". Add one in prisma/seed.ts.',
      p_entity_type using errcode = 'no_data_found';
  end if;

  if v_year then
    return format('%s-%s-%s', v_prefix, extract(year from current_date)::int,
                  lpad(v_value::text, v_padding, '0'));
  end if;

  return format('%s-%s', v_prefix, lpad(v_value::text, v_padding, '0'));
end;
$$;


-- ============ 010_fn_clawback ============
-- Atomic commission clawback.
--
-- Ports the prisma.$transaction block in src/server/commission-engine.ts
-- (clawback()). supabase-js has no transaction API — each call is a separate
-- HTTP request — so a multi-step money operation must live in the database or
-- it is not atomic.
--
-- Without this, a failure between "create reversal" and "update original"
-- leaves a reversal with the original still ACCRUED: the ledger double-counts
-- and nothing raises an error.
--
-- SECURITY INVOKER (the default): the caller's RLS still applies, so a user
-- cannot claw back a commission they cannot see. Authorization for the action
-- itself (commission:write) stays in the application layer.

create or replace function claw_back_commission(
  p_record_id uuid,
  p_reason    text,
  p_actor_id  uuid
)
returns uuid
language plpgsql
as $$
declare
  v_orig        commission_record%rowtype;
  v_window_days integer;
  v_deadline    date;
  v_new_id      uuid;
  v_number      text;
begin
  -- Lock the row for the duration of the transaction so two concurrent
  -- clawbacks cannot both pass the status check. The Prisma version relied on
  -- transaction isolation for this; FOR UPDATE makes it explicit.
  select * into v_orig
  from commission_record
  where id = p_record_id
  for update;

  if not found then
    raise exception 'Commission record % not found', p_record_id
      using errcode = 'no_data_found';
  end if;

  if v_orig.status = 'CLAWED_BACK' then
    raise exception 'This commission has already been clawed back.'
      using errcode = 'raise_exception';
  end if;

  -- Clawback window, when the plan defines one.
  select cp."clawbackWindowDays" into v_window_days
  from commission_plan cp
  where cp.id = v_orig."planId";

  if v_window_days is not null then
    v_deadline := v_orig."earnedDate" + v_window_days;
    if current_date > v_deadline then
      raise exception 'Clawback window closed on % for %', v_deadline, v_orig."commissionNumber"
        using errcode = 'raise_exception';
    end if;
  end if;

  -- Must match SEQUENCES.COMMISSION in src/lib/numbering.ts, which is the
  -- NumberSequence.entityType value 'CommissionRecord'.
  v_number := next_sequence_number('CommissionRecord');
  v_new_id := gen_random_uuid();

  -- The reversal: every money column negated.
  insert into commission_record (
    id, "commissionNumber", "partnerId", "opportunityId", "opportunityPartnerId",
    "planId", status, basis, "basisAmount", "ratePercent", "commissionAmount",
    "withholdingTaxAmount", "netPayableAmount", "currencyCode", "earnedDate",
    "reversesRecordId", "calculationNotes", "createdAt", "updatedAt"
  ) values (
    v_new_id, v_number, v_orig."partnerId", v_orig."opportunityId",
    v_orig."opportunityPartnerId", v_orig."planId", 'CLAWED_BACK', v_orig.basis,
    -v_orig."basisAmount", v_orig."ratePercent", -v_orig."commissionAmount",
    -v_orig."withholdingTaxAmount", -v_orig."netPayableAmount",
    v_orig."currencyCode", current_date, v_orig.id,
    format('Clawback of %s: %s', v_orig."commissionNumber", p_reason),
    now(), now()
  );

  update commission_record
  set status = 'CLAWED_BACK',
      "rejectionReason" = p_reason,
      "updatedAt" = now()
  where id = v_orig.id;

  insert into audit_history (
    id, "entityType", "entityId", "fieldName", "oldValue", "newValue",
    "changedById", "changedAt"
  ) values (
    gen_random_uuid(), 'CommissionRecord', v_orig.id, 'status',
    v_orig.status::text, 'CLAWED_BACK', p_actor_id, now()
  );

  return v_new_id;
end;
$$;
