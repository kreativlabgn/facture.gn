import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "./public.decorator";

// Security Audit 2026-08-23, finding #16 — money-api n'a jamais eu de guard
// global (contrairement à trust-api, JwtAuthGuard+RolesGuard deny-by-default) :
// chaque contrôleur devait explicitement poser son propre @UseGuards(). C'était
// bien fait sur les 3 routes existantes (create() protégée par InternalAuthGuard,
// getPublicCheckout() et le webhook receive() publics par conception), mais le
// modèle était fail-open par omission — toute route future ajoutée sans y penser
// aurait été non protégée par défaut.
//
// Ce guard n'authentifie RIEN lui-même (money-api n'a aucun acteur JWT humain,
// contrairement à trust-api) : il exige simplement que CHAQUE route porte
// @Public() (auth-en-service ou guard dédié déjà en place) pour être atteinte,
// sinon 403 immédiat — une tripwire structurelle, pas un mécanisme d'autorisation.
@Injectable()
export class RequireExplicitAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!isPublic) {
      throw new ForbiddenException(
        "Route non marquée @Public() — toute route money-api doit déclarer explicitement sa posture d'autorisation (Security Audit 2026-08-23, finding #16)",
      );
    }
    return true;
  }
}
