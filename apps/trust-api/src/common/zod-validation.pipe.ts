import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

// TOUJOURS scoper cette pipe au paramètre @Body() — @Body(new ZodValidationPipe(schema)).
// Un @UsePipes(new ZodValidationPipe(schema)) au niveau MÉTHODE l'applique à TOUS les
// paramètres du handler, y compris @CurrentUser()/@Param() — qui échoueront alors le
// même schéma (ex. le payload JWT {sub,iat,exp} contre un schéma attendant
// organizationId/lines). Piège déjà rencontré deux fois dans ce repo
// (organizations.controller.ts, invoices.controller.ts:createAssisted, F2) — invisible
// en test unitaire (qui appelle le service directement, jamais le pipeline HTTP), donc
// détectable seulement en E2E réel. @UsePipes() au niveau méthode n'est sûr QUE si le
// handler a un seul paramètre.
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.flatten());
    }
    return result.data;
  }
}
