import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

const INTERNAL_API_KEY_HEADER = "x-internal-api-key";

// G3, ADR-091 — déclenche CommissionBypassReviewService.openCase()/resolveCase() —
// "Squad Money" dans ADR-091, aucun OrganizationRole n'existe pour ce périmètre
// (même précédent que DgiVerificationAuthGuard/verifyDgi, B2). Secret STRICTEMENT
// dédié : ne jamais réutiliser DGI_VERIFICATION_INTERNAL_KEY/MONEY_API_INTERNAL_KEY,
// des périmètres de confiance distincts — les confondre serait une élévation de
// privilège croisée entre contextes.
// TODO(ADR-008) : HashiCorp Vault Transit en prod ; trafic sur réseau privé cluster
// uniquement (K8s OVH Gravelines, DAT §1), jamais exposé publiquement.
@Injectable()
export class CommissionBypassReviewAuthGuard implements CanActivate {
  private readonly expectedKey: string;

  constructor() {
    const key = process.env.COMMISSION_BYPASS_REVIEW_INTERNAL_KEY;
    if (!key) {
      throw new Error(
        "COMMISSION_BYPASS_REVIEW_INTERNAL_KEY manquant — voir README pour générer le secret inter-service",
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
