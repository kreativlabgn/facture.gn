import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { CommissionBypassReviewAuthGuard } from "./commission-bypass-review-auth.guard";
import {
  resolveCommissionBypassCaseSchema,
  type ResolveCommissionBypassCaseDto,
} from "./dto/resolve-commission-bypass-case.dto";
import { CommissionBypassReviewService } from "./commission-bypass-review.service";

// G3, ADR-091 — :id ici est le case, jamais l'organisation (nature différente du
// :id de CommissionBypassCasesController) — même précédent que
// RecurringTemplatesController/RecurringTemplateGenerationController, deux
// contrôleurs plutôt qu'un seul id ambigu.
@ApiTags("commission-bypass")
@Controller("commission-bypass-cases")
export class CommissionBypassCaseResolutionController {
  constructor(private readonly commissionBypassReviewService: CommissionBypassReviewService) {}

  @Post(":id/resolve")
  @Public()
  @ApiSecurity("internal-api-key")
  @UseGuards(CommissionBypassReviewAuthGuard)
  resolve(
    @Param("id") caseId: string,
    @Body(new ZodValidationPipe(resolveCommissionBypassCaseSchema)) dto: ResolveCommissionBypassCaseDto,
  ) {
    return this.commissionBypassReviewService.resolveCase(caseId, dto.decision, dto.operatorId);
  }
}
