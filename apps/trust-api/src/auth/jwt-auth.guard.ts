import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTH_TOKEN_SERVICE } from "./auth.tokens";
import type { AuthTokenService } from "./auth-token.service";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { TokenRevocationService } from "./token-revocation.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_TOKEN_SERVICE) private readonly tokenService: AuthTokenService,
    private readonly tokenRevocation: TokenRevocationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authorization: string | undefined = request.headers?.authorization;
    const token = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;

    if (!token) {
      throw new UnauthorizedException("Token d'authentification manquant");
    }

    let payload;
    try {
      payload = await this.tokenService.verify(token);
    } catch {
      throw new UnauthorizedException("Token d'authentification invalide ou expiré");
    }

    // Security Audit 2026-08-23, finding #14 — consultée à CHAQUE requête (pas
    // seulement au login) : c'est la seule façon d'invalider un token avant son
    // expiration naturelle (12h) suite à POST /auth/logout ou une compromission
    // détectée. Un token expiré est déjà rejeté par verify() ci-dessus, donc cette
    // vérification supplémentaire ne concerne que les tokens encore valides.
    if (await this.tokenRevocation.isRevoked(payload.jti)) {
      throw new UnauthorizedException("Token d'authentification révoqué");
    }

    // Cross-Story Audit 2026-08-24, finding #1 — scope propagé tel quel (undefined
    // pour un token login()/register() de portée complète, "client_portal" pour un
    // token issu de ClientPortalAuthService.verifyOtp()) : c'est la seule donnée
    // que RolesGuard/ClientPortalScopeGuard consultent pour décider qui accède à
    // quoi, jamais recalculée ailleurs.
    request.user = { id: payload.sub, jti: payload.jti, exp: payload.exp, scope: payload.scope };
    return true;
  }
}
