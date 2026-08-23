import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

const INTERNAL_API_KEY_HEADER = "x-internal-api-key";

// Authentifie les appels inter-service (trust-api → money-api) par clé partagée
// simple : réseau privé contrôlé, pas un webhook tiers non fiable (contrairement à
// ADR-082 où HMAC est justifié). Fail-fast au démarrage si non configurée, même
// posture que JWT_PRIVATE_KEY/CERTIFICATION_PRIVATE_KEY côté trust-api.
// TODO(ADR-008) : HashiCorp Vault Transit en prod (secret actuellement en clair via
// .env, comme JWT_PRIVATE_KEY/CERTIFICATION_PRIVATE_KEY) ; le trafic inter-service
// doit transiter sur le réseau privé du cluster (K8s OVH Gravelines, DAT §1),
// jamais exposé publiquement — TLS interne au cluster à valider avant la prod.
//
// Quality Audit 2026-08-23, finding #14 — mirroir de
// apps/trust-api/src/common/internal-auth.guard.ts, duplication verbatim
// délibérément conservée (pas de package partagé de code applicatif dans ce
// monorepo, seulement packages/db) — voir ce fichier pour la justification
// complète. Si ce guard évolue un jour, modifier les DEUX fichiers.
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

  // Comparaison à temps constant — jamais `===` sur un secret (fuite par timing).
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
