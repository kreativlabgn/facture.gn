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

// ADR-068/078 — TOUT MEMBRE ACTIF, quel que soit son rôle.
//
// Distinct d'assertPracticeAdmin, et la nuance est dans la règle de gestion :
// le scope d'accountant_external porte `mandate:request`. Demander un mandat
// n'engage rien — c'est l'ORGANISATION qui accepte, explicitement (PWA ou
// *620# option 5.3 + PIN), et qui peut révoquer à tout moment. Exiger un
// practice_admin pour une simple demande suspendait le travail quotidien d'un
// collaborateur à la disponibilité d'un associé.
//
// `leftAt: null` est la clause qui compte : c'est elle qui coupe d'un seul coup
// tous les accès d'un collaborateur parti, le mandat étant accordé à l'ENTITÉ
// et jamais à l'individu.
export async function assertPracticeMember(
  prisma: PrismaClient,
  practiceId: string,
  userId: string,
  action = "effectuer cette action",
): Promise<void> {
  const membership = await prisma.practiceMember.findFirst({
    where: { practiceId, userId, leftAt: null },
  });
  if (!membership) {
    throw new ForbiddenException(`Seul un membre du cabinet peut ${action}`);
  }
}
