import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { generateRevenueShareSchema, type GenerateRevenueShareDto } from "./dto/generate-revenue-share.dto";
import { RevenueShareService } from "./revenue-share.service";

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

function currentPeriodMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
