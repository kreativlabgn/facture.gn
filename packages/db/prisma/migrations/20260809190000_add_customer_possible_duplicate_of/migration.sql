-- AlterTable
ALTER TABLE "customer" ADD COLUMN     "possible_duplicate_of" TEXT;

-- AddForeignKey
ALTER TABLE "customer" ADD CONSTRAINT "customer_possible_duplicate_of_fkey" FOREIGN KEY ("possible_duplicate_of") REFERENCES "customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
