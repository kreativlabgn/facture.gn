import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { CommissionBypassReviewAuthGuard } from "./commission-bypass-review-auth.guard";
import {
  openCommissionBypassCaseSchema,
  type OpenCommissionBypassCaseDto,
} from "./dto/open-commission-bypass-case.dto";
import { CommissionBypassReviewService } from "./commission-bypass-review.service";

// G3, ADR-091 — appel machine-à-machine exclusif (outil interne Squad Money,
// jamais un rôle humain organisationnel) : @Public() court-circuite JwtAuthGuard,
// RolesGuard est un no-op sans @Roles(), CommissionBypassReviewAuthGuard est le
// seul vrai garde — même précédent que OrganizationsController.verifyDgi() (B2).
@ApiTags("commission-bypass")
@Controller("organizations/:id/commission-bypass-cases")
export class CommissionBypassCasesController {
  constructor(private readonly commissionBypassReviewService: CommissionBypassReviewService) {}

  @Post()
  @Public()
  @ApiSecurity("internal-api-key")
  @UseGuards(CommissionBypassReviewAuthGuard)
  open(@Param("id") organizationId: string, @Body(new ZodValidationPipe(openCommissionBypassCaseSchema)) dto: OpenCommissionBypassCaseDto) {
    return this.commissionBypassReviewService.openCase(organizationId, dto.detectedPatterns);
  }
}
