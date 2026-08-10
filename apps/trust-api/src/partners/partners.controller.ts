import { Body, Controller, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { Public } from "../auth/public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { createFromApipSchema, type CreateFromApipDto } from "../organizations/dto/create-from-apip.dto";
import { OrganizationsService } from "../organizations/organizations.service";
import { PartnerWebhookAuthGuard } from "./partner-webhook-auth.guard";

// ADR-077 — pattern EXACT imposé par l'ADR (POST /v1/partners/{partner_type}/
// {event}), premier endpoint versionné de ce repo (divergence assumée du reste
// de l'API, flat/non-versionnée — imposée par la décision, pas un choix libre
// de cette story). @Public() court-circuite JwtAuthGuard (un partenaire externe
// n'est pas un utilisateur facture.gn, ADR-082) — PartnerWebhookAuthGuard est le
// seul vrai garde, même posture que InternalAuthGuard côté money-api.
@ApiTags("partners")
@Controller("v1/partners")
export class PartnersController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post(":partnerType/:event")
  @Public()
  @ApiSecurity("partner-webhook")
  @UseGuards(PartnerWebhookAuthGuard)
  handleEvent(
    @Param("partnerType") partnerType: string,
    @Param("event") event: string,
    @Body(new ZodValidationPipe(createFromApipSchema)) dto: CreateFromApipDto,
  ) {
    // Seul apip/company-created a une intégration technique réelle (ADR-078 —
    // "FODIP et 3AE restent hors plateforme, aucune intégration technique").
    if (partnerType !== "apip" || event !== "company-created") {
      throw new NotFoundException(`Événement partenaire ${partnerType}/${event} non supporté`);
    }
    return this.organizationsService.createFromApip(dto);
  }
}
