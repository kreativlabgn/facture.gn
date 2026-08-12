import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { createMandateSchema, type CreateMandateDto } from "./dto/create-mandate.dto";
import { MandatesService } from "./mandates.service";

@ApiTags("mandates")
@ApiBearerAuth()
@Controller("practices/:id/mandates")
export class MandatesController {
  constructor(private readonly mandatesService: MandatesService) {}

  // Aucun @Roles() : RolesGuard résout exclusivement une organisation, un mandat
  // est practice-scopé (voir mandates.service.ts). :id est ici la practice, pas
  // une organisation ni une facture — l'autorisation (practice_admin) est vérifiée
  // en ligne dans le service.
  @Post()
  create(
    @Param("id") practiceId: string,
    @Body(new ZodValidationPipe(createMandateSchema)) dto: CreateMandateDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.mandatesService.create(practiceId, dto, user.id);
  }

  // F6, ADR-069 — même acteur et même garde en ligne que create() (practice_admin).
  @Post(":mandateId/revoke")
  revoke(
    @Param("id") practiceId: string,
    @Param("mandateId") mandateId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.mandatesService.revoke(practiceId, mandateId, user.id);
  }

  // F12, ADR-078 — accepte une demande INITIÉE PAR L'ORGANISATION (contrepartie
  // de POST /organizations/:id/mandates). Nommage distinct de /accept (côté
  // organisation, F1) pour éviter toute ambiguïté entre les deux sens.
  @Post(":mandateId/accept-request")
  acceptRequest(
    @Param("id") practiceId: string,
    @Param("mandateId") mandateId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.mandatesService.acceptAsPractice(practiceId, mandateId, user.id);
  }

  // Écran "Mandats" du dashboard cabinet — pending + active, distinct de
  // GET /practices/:id/organizations (F7, actifs uniquement). Aucun @Roles() :
  // tout membre actif suffit (autorisation en ligne dans MandatesService.listAll()).
  @Get()
  listAll(@Param("id") practiceId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mandatesService.listAll(practiceId, user.id);
  }
}
