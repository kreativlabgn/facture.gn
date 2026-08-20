import { Body, Controller, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import {
  createRecurringTemplateSchema,
  type CreateRecurringTemplateDto,
} from "./dto/create-recurring-template.dto";
import { RecurringTemplatesService } from "./recurring-templates.service";

// I1, ADR-056 — même trio élargi que POST /invoices/POST /branches : définir un
// modèle récurrent est une action de structuration, pas une action financière
// en soi. :id = l'organisation (idSource "organization"), pas le modèle.
@ApiTags("recurring-templates")
@ApiBearerAuth()
@Controller("organizations/:id/recurring-templates")
export class RecurringTemplatesController {
  constructor(private readonly recurringTemplatesService: RecurringTemplatesService) {}

  @Post()
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  @OrganizationIdSource("organization")
  create(
    @Param("id") organizationId: string,
    @Body(new ZodValidationPipe(createRecurringTemplateSchema)) dto: CreateRecurringTemplateDto,
  ) {
    return this.recurringTemplatesService.create(organizationId, dto);
  }
}

// Contrôleur séparé (même pattern que MandatesController/OrganizationMandatesController,
// PublicBuyerAccountsController/PublicBuyerPortalController) : :id désigne ici
// le MODÈLE récurrent, pas l'organisation — idSource "recurring-template".
@ApiTags("recurring-templates")
@ApiBearerAuth()
@Controller("recurring-templates/:id")
export class RecurringTemplateGenerationController {
  constructor(private readonly recurringTemplatesService: RecurringTemplatesService) {}

  @Post("generate")
  @Roles("owner", "admin", "accountant_internal", "cashier", "field_agent")
  @OrganizationIdSource("recurring-template")
  generate(@Param("id") templateId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.recurringTemplatesService.generate(templateId, user.id);
  }
}
