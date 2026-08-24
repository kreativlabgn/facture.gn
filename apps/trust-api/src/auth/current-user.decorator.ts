import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export interface CurrentUserPayload {
  id: string;
  // Security Audit 2026-08-23, finding #14 — peuplés par JwtAuthGuard depuis le
  // payload JWT vérifié, nécessaires à AuthController.logout() pour révoquer
  // précisément CE token (jamais recalculés/devinés côté service).
  jti?: string;
  exp?: number;
  // Cross-Story Audit 2026-08-24, finding #1 — voir AuthTokenPayload.scope.
  scope?: string;
}

// req.user est attaché par JwtAuthGuard — jamais accessible sur une route @Public().
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): CurrentUserPayload => {
  const request = context.switchToHttp().getRequest();
  return request.user;
});
