import { BadRequestException, Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { generateRevenueShareSchema, type GenerateRevenueShareDto } from "./dto/generate-revenue-share.dto";
import { RevenueShareService } from "./revenue-share.service";

// H3 — même regex que generate-revenue-share.dto.ts, vérifiée manuellement ici
// (paramètre de route, pas un body Zod-validable par ZodValidationPipe).
const PERIOD_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// H4, ADR-071 — aucun @Roles() (practice_admin n'est pas un OrganizationRole),
// même style que PracticesController (F8).
@ApiTags("revenue-share")
@ApiBearerAuth()
@Controller("practices/:id/revenue-share")
export class RevenueShareController {
  constructor(private readonly revenueShareService: RevenueShareService) {}

  @Post("generate")
  generate(
    @Param("id") practiceId: string,
    @Body(new ZodValidationPipe(generateRevenueShareSchema)) dto: GenerateRevenueShareDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.revenueShareService.generate(practiceId, user.id, dto.periodMonth ?? currentPeriodMonth());
  }

  @Get()
  list(@Param("id") practiceId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.revenueShareService.listByPractice(practiceId, user.id);
  }
}

// H3, ADR-071 — contrôleur séparé (:id désigne toujours la practice ici, mais
// le chemin racine diffère de RevenueShareController ci-dessus) pour rester
// cohérent avec la route dédiée /partner-subscription/:periodMonth.
@ApiTags("revenue-share")
@ApiBearerAuth()
@Controller("practices/:id/partner-subscription")
export class PartnerSubscriptionController {
  constructor(private readonly revenueShareService: RevenueShareService) {}

  @Get(":periodMonth")
  getStatus(
    @Param("id") practiceId: string,
    @Param("periodMonth") periodMonth: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    if (!PERIOD_MONTH_PATTERN.test(periodMonth)) {
      throw new BadRequestException("Format attendu pour periodMonth : YYYY-MM");
    }
    return this.revenueShareService.getPartnerSubscriptionStatus(practiceId, user.id, periodMonth);
  }
}

function currentPeriodMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
