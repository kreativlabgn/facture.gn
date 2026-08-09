import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser, type CurrentUserPayload } from "../auth/current-user.decorator";
import { MandatesService } from "../mandates/mandates.service";
import { createPracticeSchema, type CreatePracticeDto } from "./dto/create-practice.dto";
import { inviteMemberSchema, type InviteMemberDto } from "./dto/invite-member.dto";
import { PracticesService } from "./practices.service";

@ApiTags("practices")
@ApiBearerAuth()
@Controller("practices")
export class PracticesController {
  constructor(
    private readonly practicesService: PracticesService,
    private readonly mandatesService: MandatesService,
  ) {}

  // Aucun rôle requis : une practice n'est PAS scopée à une organisation existante
  // (ADR-068, entité de premier niveau parallèle) — n'importe quel utilisateur
  // authentifié peut en créer une, il en devient automatiquement practice_admin
  // (voir service). Même principe que OrganizationsController.create().
  @Post()
  create(
    @Body(new ZodValidationPipe(createPracticeSchema)) dto: CreatePracticeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.practicesService.create(dto, user.id);
  }

  // F8, ADR-068 — aucun @Roles() (practice_admin n'est pas un OrganizationRole),
  // autorisation en ligne dans le service. Pipe scopé au paramètre @Body() —
  // jamais @UsePipes() au niveau méthode ici (échouerait @CurrentUser() contre
  // le même schéma, piège documenté dans ZodValidationPipe, F2).
  @Post(":id/members")
  inviteMember(
    @Param("id") practiceId: string,
    @Body(new ZodValidationPipe(inviteMemberSchema)) dto: InviteMemberDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.practicesService.inviteMember(practiceId, dto, user.id);
  }

  // F7, ADR-070 — donnée source d'un sélecteur "switch organisation" côté client
  // (PWA/dashboard) : le switch lui-même reste un problème client, aucun état
  // "organisation courante" n'est maintenu côté serveur (cohérent avec le modèle
  // stateless déjà utilisé partout dans ce repo). Tout membre actif de la
  // practice (pas seulement practice_admin) peut consulter cette liste.
  @Get(":id/organizations")
  listAccessibleOrganizations(@Param("id") practiceId: string, @CurrentUser() user: CurrentUserPayload) {
    return this.mandatesService.listAccessibleOrganizations(practiceId, user.id);
  }

  // F12, ADR-078 — "liste des CGA actifs" pour le bouton « Adhérer à un CGA ».
  // "cga" hardcodé, JAMAIS un paramètre client (finding sécurité corrigé avant
  // merge, dev-security-reviewer) : accepter un type arbitraire exposerait
  // nom/téléphone/email de TOUS les cabinets comptables/gestionnaires/
  // fiduciaires à n'importe quel utilisateur authentifié, bien au-delà du scope
  // réel de cette story. Aucun autre type n'est un besoin actuel — si un jour
  // nécessaire, une route dédiée ou un allowlist explicite, jamais un passthrough.
  // Aucun @Roles() : cette liste n'est scopée à aucune organisation précise
  // (JwtAuthGuard suffit, même principe que create() ci-dessus).
  @Get()
  findAllByType() {
    return this.practicesService.findAllByType("cga");
  }
}
