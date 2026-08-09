-- CreateEnum
CREATE TYPE "MandateInitiator" AS ENUM ('practice', 'organization');

-- AlterTable
-- DEFAULT temporaire pour satisfaire les lignes déjà existantes (toutes créées
-- via MandatesService.create(), F5 — donc légitimement "practice") ; retiré
-- ensuite car le schema Prisma ne déclare aucun @default — chaque écriture
-- future doit spécifier initiatedBy explicitement (create()/requestFromOrganization()).
ALTER TABLE "mandate" ADD COLUMN     "initiated_by" "MandateInitiator" NOT NULL DEFAULT 'practice';
ALTER TABLE "mandate" ALTER COLUMN "initiated_by" DROP DEFAULT;
