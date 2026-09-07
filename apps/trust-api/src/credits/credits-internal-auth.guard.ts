import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";

const INTERNAL_API_KEY_HEADER = "x-internal-api-key";

// Console d'administration facture.gn — rechargement d'un portefeuille de
// crédits. Aucun OrganizationRole ne convient : ce n'est pas le commerçant qui
// décide de son propre solde, c'est la plateforme qui le crédite après
// encaissement hors ligne. Secret STRICTEMENT dédié — ne jamais réutiliser
// MONEY_API_INTERNAL_KEY ni DATA_RIGHTS_INTERNAL_KEY : périmètres de confiance
// distincts, et celui-ci crée de la valeur monétaire. Trafic sur réseau privé
// cluster uniquement, jamais exposé publiquement.
@Injectable()
export class CreditsInternalAuthGuard implements CanActivate {
  private readonly expectedKey: string;

  constructor() {
    const key = process.env.CREDITS_INTERNAL_KEY;
    if (!key) {
      throw new Error(
        "CREDITS_INTERNAL_KEY manquant — voir README pour générer le secret inter-service",
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
