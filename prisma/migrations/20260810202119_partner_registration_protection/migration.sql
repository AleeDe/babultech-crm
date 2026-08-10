-- Negotiated protection window for a specific partner. Null means the tier
-- default applies (src/lib/partner-policy.ts).
-- AlterTable
ALTER TABLE "partner" ADD COLUMN     "registrationProtectionDays" INTEGER;
