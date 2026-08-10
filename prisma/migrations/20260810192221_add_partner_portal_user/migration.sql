-- Portal login for a partner. Nullable and unique: most users are employees and
-- have no partner, and a partner never has more than one login.
-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "partnerId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "app_user_partnerId_key" ON "app_user"("partnerId");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
