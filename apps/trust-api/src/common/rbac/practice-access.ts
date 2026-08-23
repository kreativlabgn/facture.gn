import { ForbiddenException } from "@nestjs/common";
import type { PrismaClient } from "@facture-gn/db";

// Quality Audit 2026-08-23, finding #8 — même requête et même condition
// (practiceMember.findFirst + role==="practice_admin") réimplémentées
// indépendamment dans mandates.service.ts, practices.service.ts et
// revenue-share.service.ts (3e occurrence, seuil "règle de trois" atteint —
// même discipline déjà appliquée ailleurs dans ce repo). Une seule source de
// vérité : un futur changement du modèle d'autorisation cabinet (nouveau rôle
// équivalent, changement du critère leftAt) n'a plus qu'un seul endroit à
// modifier pour une règle qui gate l'upgrade de palier, la génération de
// revenue share et la création/révocation de mandat.
export async function assertPracticeAdmin(
  prisma: PrismaClient,
  practiceId: string,
  userId: string,
  action = "effectuer cette action",
): Promise<void> {
  const membership = await prisma.practiceMember.findFirst({
    where: { practiceId, userId, leftAt: null },
  });
  if (!membership || membership.role !== "practice_admin") {
    throw new ForbiddenException(`Seul un practice_admin du cabinet peut ${action}`);
  }
}
