import { Controller, Get, Param, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { FecService } from "./fec.service";

@ApiTags("fec")
@ApiBearerAuth()
@Controller("organizations/:id/fec")
export class FecController {
  constructor(private readonly fecService: FecService) {}

  // Aucun @Roles() : l'autorisation combine deux systèmes RBAC (OrganizationMember
  // ET Mandate) — voir FecService.assertAccess(). Réponse text/plain, jamais du
  // JSON : le FEC est un fichier à télécharger, pas une ressource API classique
  // — première route de ce repo à utiliser @Res() directement.
  @Get()
  async export(
    @Param("id") organizationId: string,
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: Response,
  ) {
    const fec = await this.fecService.export(organizationId, user.id);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="FEC_${organizationId}.txt"`);
    res.send(fec);
  }
}
