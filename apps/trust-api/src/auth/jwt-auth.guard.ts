import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTH_TOKEN_SERVICE } from "./auth.tokens";
import type { AuthTokenService } from "./auth-token.service";
import { IS_PUBLIC_KEY } from "./public.decorator";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_TOKEN_SERVICE) private readonly tokenService: AuthTokenService,
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

    try {
      const payload = await this.tokenService.verify(token);
      request.user = { id: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException("Token d'authentification invalide ou expiré");
    }
  }
}
