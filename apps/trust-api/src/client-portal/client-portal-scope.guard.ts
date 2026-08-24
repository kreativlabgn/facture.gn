import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";

// Cross-Story Audit 2026-08-24, finding #1 — barrière symétrique à la garde posée
// dans RolesGuard : alors que RolesGuard rejette tout token scope:"client_portal"
// sur une route @Roles(), ce guard rejette ici tout token qui ne serait NI
// scope:"client_portal" NI de portée complète (scope absent — ex. un owner qui
// consulterait aussi son propre portail client) sur les routes du portail client
// elles-mêmes (ClientPortalController/ClientPortalAuthController). Aucune autre
// valeur de scope n'existe à ce jour, mais cette liste blanche explicite (plutôt
// qu'un "tout sauf X") reste correcte si un futur scope plus restreint (ex. un
// scope USSD dédié) est introduit sans jamais devoir donner accès au portail
// client par accident.
//
// Placé en garde LOCALE (@UseGuards sur le contrôleur), pas globale : elle
// s'exécute après JwtAuthGuard/RolesGuard (déjà globaux via APP_GUARD,
// app.module.ts), donc request.user est déjà peuplé quand elle s'exécute — sauf
// sur les deux routes @Public() de ClientPortalAuthController (request/verify),
// où request.user est simplement absent et où ce guard est donc un no-op
// (scope undefined y est toujours accepté, cohérent avec leur absence
// d'authentification préalable).
@Injectable()
export class ClientPortalScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const scope: string | undefined = request.user?.scope;

    if (scope !== undefined && scope !== "client_portal") {
      throw new ForbiddenException("Ce token n'est pas autorisé sur le portail client");
    }

    return true;
  }
}
