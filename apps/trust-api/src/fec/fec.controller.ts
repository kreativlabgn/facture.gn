import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { FecService } from "./fec.service";
import { exportFecQuerySchema, type ExportFecQueryDto } from "./dto/export-fec-query.dto";

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
    @Query(new ZodValidationPipe(exportFecQuerySchema)) query: ExportFecQueryDto,
    @Res() res: Response,
  ) {
    const fiscalYear = query.year ?? new Date().getFullYear();
    const fec = await this.fecService.export(organizationId, user.id, fiscalYear);
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="FEC_${organizationId}_${fiscalYear}.txt"`);
    res.send(fec);
  }
}
