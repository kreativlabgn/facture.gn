import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

const INTERNAL_API_KEY_HEADER = "x-internal-api-key";

// Déclenche OrganizationsService.verifyDgi() (B2) — "en tant que système" dans le
// backlog, aucun rôle organisationnel n'existe pour cette action (OrganizationRole
// est strictement scopé à une organisation, jamais un rôle plateforme facture.gn).
// Secret STRICTEMENT dédié : ne jamais réutiliser MONEY_API_INTERNAL_KEY, qui
// appartient à un périmètre de confiance distinct (money-api → trust-api, C2 Phase
// 2b) — les confondre serait une élévation de privilège croisée entre contextes.
// TODO(ADR-008) : HashiCorp Vault Transit en prod ; trafic sur réseau privé cluster
// uniquement (K8s OVH Gravelines, DAT §1), jamais exposé publiquement.
@Injectable()
export class DgiVerificationAuthGuard implements CanActivate {
  private readonly expectedKey: string;

  constructor() {
    const key = process.env.DGI_VERIFICATION_INTERNAL_KEY;
    if (!key) {
      throw new Error(
        "DGI_VERIFICATION_INTERNAL_KEY manquant — voir README pour générer le secret inter-service",
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
