import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

const INTERNAL_API_KEY_HEADER = "x-internal-api-key";

// J2, ADR-116 — chemin ops plateforme pour les droits des personnes
// (accès / anonymisation transverses). Aucun OrganizationRole ne convient : une
// demande d'un particulier peut couvrir plusieurs organisations. Secret
// STRICTEMENT dédié — ne jamais réutiliser MONEY_API_INTERNAL_KEY /
// DGI_VERIFICATION_INTERNAL_KEY (périmètres de confiance distincts). Trafic sur
// réseau privé cluster uniquement, jamais exposé publiquement.
@Injectable()
export class DataRightsInternalAuthGuard implements CanActivate {
  private readonly expectedKey: string;

  constructor() {
    const key = process.env.DATA_RIGHTS_INTERNAL_KEY;
    if (!key) {
      throw new Error(
        "DATA_RIGHTS_INTERNAL_KEY manquant — voir README pour générer le secret inter-service",
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
