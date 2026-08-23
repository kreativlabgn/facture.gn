-- AlterTable
ALTER TABLE "product" ADD COLUMN     "possible_duplicate_of" TEXT;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_possible_duplicate_of_fkey" FOREIGN KEY ("possible_duplicate_of") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
