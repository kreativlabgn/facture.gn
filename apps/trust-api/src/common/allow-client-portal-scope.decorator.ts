import { SetMetadata } from "@nestjs/common";

export const ALLOW_CLIENT_PORTAL_SCOPE_KEY = "allowClientPortalScope";

// Cross-Story Audit 2026-08-24, finding #1 (résiduel) — même idiome que @Public()
// (auth/public.decorator.ts) : marque une route/un contrôleur comme légitimement
// accessible avec un token scope:"client_portal" (OTP F13, preuve de possession
// du téléphone uniquement, jamais un mot de passe). Lu par JwtAuthGuard, qui
// rejette PAR DÉFAUT tout token scope:"client_portal" sur toute route n'affichant
// pas ce marqueur — deny-by-default global, avant même que RolesGuard ou un
// service métier ne soit atteint. Contrairement à @Roles(), qui protège
// route-par-route et que plusieurs contrôleurs contournent délibérément (FEC,
// mandates, cabinet-view, ...), ce marqueur est vérifié pour TOUTE requête
// authentifiée, sans exception possible par omission.
export const AllowClientPortalScope = () => SetMetadata(ALLOW_CLIENT_PORTAL_SCOPE_KEY, true);
