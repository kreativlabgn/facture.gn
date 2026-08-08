import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

export interface CurrentUserPayload {
  id: string;
}

// req.user est attaché par JwtAuthGuard — jamais accessible sur une route @Public().
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): CurrentUserPayload => {
  const request = context.switchToHttp().getRequest();
  return request.user;
});
