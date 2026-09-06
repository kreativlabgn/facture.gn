import { InternalServerErrorException, createParamDecorator, type ExecutionContext } from "@nestjs/common";

/**
 * Organisation résolue par `RolesGuard`, exposée au handler.
 *
 * Le guard connaît déjà l'`organizationId` : il vient de le résoudre depuis
 * `params.id` en relisant la ressource ciblée (voir `resolveOrganizationId`).
 * Sans ce décorateur, chaque service le redécouvrait par une lecture de plus —
 * et surtout une lecture NON scopée, celle qui devient impossible une fois RLS
 * appliqué (docs/runbooks/rls-rollout.md, étape 1 : l'œuf et la poule).
 *
 * Échoue FORT plutôt que de rendre `undefined` : `RolesGuard` sort avant toute
 * résolution quand la route ne porte pas de `@Roles()`. Poser ce décorateur sur
 * une telle route est un bug de câblage, pas un cas d'exécution — un `undefined`
 * silencieux se propagerait jusqu'à un `where: { organizationId: undefined }`,
 * c'est-à-dire un filtre absent.
 */
export const CurrentOrganizationId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const request = context.switchToHttp().getRequest();
  const organizationId: unknown = request?.organizationId;

  if (typeof organizationId !== "string" || organizationId === "") {
    throw new InternalServerErrorException(
      "@CurrentOrganizationId() utilisé sur une route sans @Roles() — RolesGuard n'a résolu aucune organisation",
    );
  }

  return organizationId;
});
