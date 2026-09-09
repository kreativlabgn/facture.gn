import { InternalServerErrorException, createParamDecorator, type ExecutionContext } from "@nestjs/common";

/** Identité du connecteur ERP, résolue par `PdpApiKeyAuthGuard` depuis le seul
 *  en-tête `X-PDP-API-Key`. */
export interface PdpClientContext {
  organizationId: string;
  apiKeyId: string;
}

/**
 * Connecteur PDP authentifié, exposé au handler.
 *
 * Échoue FORT plutôt que de rendre `undefined`, exactement comme
 * `@CurrentOrganizationId()` : poser ce décorateur sur une route dépourvue de
 * `@UseGuards(PdpApiKeyAuthGuard)` est un bug de câblage, pas un cas
 * d'exécution. Un `undefined` silencieux se propagerait jusqu'à un
 * `organizationId: undefined` en base — c'est-à-dire, sous RLS, une écriture
 * refusée dans le meilleur des cas, et un document fiscal rattaché à personne
 * dans le pire.
 */
export const PdpClient = createParamDecorator((_data: unknown, context: ExecutionContext): PdpClientContext => {
  const request = context.switchToHttp().getRequest();
  const client: unknown = request?.pdpClient;

  if (
    typeof client !== "object" ||
    client === null ||
    typeof (client as PdpClientContext).organizationId !== "string" ||
    typeof (client as PdpClientContext).apiKeyId !== "string"
  ) {
    throw new InternalServerErrorException(
      "@PdpClient() utilisé sur une route sans PdpApiKeyAuthGuard — aucun connecteur n'a été authentifié",
    );
  }

  return client as PdpClientContext;
});
