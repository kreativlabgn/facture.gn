import type { Prisma } from "@facture-gn/db";

// Quality Audit 2026-08-23, finding #2 — Mandate.expiresAt existait en schéma
// depuis le début mais n'était appliqué à AUCUN point de lecture qui autorise un
// accès (même trou déjà corrigé sur AssistedSession, Security Audit finding #8 —
// jamais répliqué ici alors que l'accès qu'un Mandate accorde à un cabinet/CGA
// est bien plus large : factures, export FEC, revenue share d'une organisation
// cliente entière). Pas de cron de purge qui ferait transiter status vers
// "expired" (même limite déjà assumée ailleurs dans ce repo pour UssdSession/
// RevokedToken) — filtré à la lecture, à CHAQUE point d'accès, jamais un simple
// "status: active" en base qui ne se corrige jamais tout seul.
export function mandateNotExpiredWhere(): Prisma.MandateWhereInput {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
}
