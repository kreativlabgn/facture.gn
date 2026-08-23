import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

const INTERNAL_API_KEY_HEADER = "x-internal-api-key";

// Mirroir exact de apps/money-api/src/common/internal-auth.guard.ts — authentifie
// les appels inter-service entrants (money-api → trust-api, confirmation de
// paiement C2 Phase 2b), même secret partagé MONEY_API_INTERNAL_KEY, même
// comparaison à temps constant. Fail-fast au démarrage si non configurée, même
// posture que JWT_PRIVATE_KEY/CERTIFICATION_PRIVATE_KEY.
// TODO(ADR-008) : HashiCorp Vault Transit en prod ; trafic sur réseau privé cluster
// uniquement (K8s OVH Gravelines, DAT §1), jamais exposé publiquement.
//
// Quality Audit 2026-08-23, finding #14 — duplication verbatim évaluée et
// délibérément conservée, pas factorisée : `packages/db` est aujourd'hui le
// SEUL package partagé du monorepo (couche données Prisma) ; trust-api et
// money-api n'ont aucun package de code applicatif commun. Créer un nouveau
// package (ex. packages/shared-guards) rien que pour ces ~50 lignes ajouterait
// un package.json/tsconfig/étape de build supplémentaires à maintenir dans les
// deux apps pour un composant stable qui ne change quasiment jamais — coût
// d'infrastructure disproportionné (voir le refus déjà acté ailleurs dans ce
// repo pour CONFIG_PARAMETER générique, même logique). Si ce guard évolue un
// jour (rotation de clé, algorithme différent), modifier les DEUX fichiers.
@Injectable()
export class InternalAuthGuard implements CanActivate {
  private readonly expectedKey: string;

  constructor() {
    const key = process.env.MONEY_API_INTERNAL_KEY;
    if (!key) {
      throw new Error(
        "MONEY_API_INTERNAL_KEY manquant — voir README pour générer le secret inter-service",
      );
    }
    this.expectedKey = key;
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers?.[INTERNAL_API_KEY_HEADER];

    if (!this.isValidKey(provided)) {
      throw new UnauthorizedException("Clé inter-service invalide");
    }
    return true;
  }

  private isValidKey(provided: unknown): boolean {
    if (typeof provided !== "string") {
      return false;
    }
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(this.expectedKey);
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
