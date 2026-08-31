import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";

import { Public } from "../auth/public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { DataRightsInternalAuthGuard } from "./data-rights-internal-auth.guard";
import { DataRightsService } from "./data-rights.service";
import { opsSubjectSchema, type OpsSubjectDto } from "./dto/data-rights.dto";

// J2, ADR-116 — chemin ops plateforme, portée TRANSVERSE (toutes organisations).
// @Public() court-circuite JwtAuthGuard ; RolesGuard est un no-op sans @Roles() ;
// DataRightsInternalAuthGuard (secret dédié DATA_RIGHTS_INTERNAL_KEY) est la
// seule barrière. Réseau privé cluster uniquement — jamais exposé publiquement.
@ApiExcludeController()
@Controller("internal/data-rights")
export class InternalDataRightsController {
  constructor(private readonly dataRights: DataRightsService) {}

  @Post("export")
  @Public()
  @UseGuards(DataRightsInternalAuthGuard)
  export(@Body(new ZodValidationPipe(opsSubjectSchema)) dto: OpsSubjectDto) {
    return this.dataRights.exportSubjectData({ phone: dto.phone, organizationId: null });
  }

  @Post("anonymize")
  @Public()
  @UseGuards(DataRightsInternalAuthGuard)
  anonymize(@Body(new ZodValidationPipe(opsSubjectSchema)) dto: OpsSubjectDto) {
    return this.dataRights.anonymizeSubjectByPhone({ phone: dto.phone, organizationId: null });
  }
}
