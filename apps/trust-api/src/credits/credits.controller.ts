import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Public } from "../auth/public.decorator";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { CreditsInternalAuthGuard } from "./credits-internal-auth.guard";
import { CreditsService } from "./credits.service";
import { grantCreditsSchema, type GrantCreditsDto } from "./dto/grant-credits.dto";

// Lecture du portefeuille par le commerçant. owner/admin seulement : un solde
// et un relevé de consommation disent combien l'entreprise dépense, ce n'est
// ni du ressort d'un caissier ni de celui d'un agent terrain.
@ApiTags("credits")
@ApiBearerAuth()
@Controller("organizations/:id/credits")
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get()
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  async getWallet(@Param("id") organizationId: string) {
    const [balanceCentimes, transactions] = await Promise.all([
      this.creditsService.getBalance(organizationId),
      this.creditsService.getStatement(organizationId),
    ]);
    return { balanceCentimes, transactions };
  }
}

// Rechargement — console d'administration facture.gn.
//
// CONTRÔLEUR SÉPARÉ, chemin /internal, secret dédié : créditer un portefeuille
// crée de la valeur monétaire. Ce n'est pas une action du commerçant, c'est une
// décision de la plateforme après un encaissement qui s'est fait ailleurs
// (virement, espèces, Mobile Money hors plateforme). @Public() court-circuite
// JwtAuthGuard — l'appelant est un outil interne, pas un utilisateur — et
// CreditsInternalAuthGuard est le seul vrai garde. Même posture que
// InternalDataRightsController (J2, ADR-116).
//
// Aucun scope RLS n'est posé par le garde : le service scope lui-même chaque
// mouvement sur l'organisation créditée.
@ApiTags("credits")
@Controller("internal/credits")
export class InternalCreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Public()
  @ApiSecurity("internal-api-key")
  @UseGuards(CreditsInternalAuthGuard)
  @Post("grant")
  grant(@Body(new ZodValidationPipe(grantCreditsSchema)) dto: GrantCreditsDto) {
    return this.creditsService.grant(dto.organizationId, BigInt(dto.amountCentimes), dto.label);
  }

  // Recalcule le solde depuis le registre. Outil d'exploitation : le registre
  // étant la vérité, cette route ne peut que corriger la dénormalisation.
  @Public()
  @ApiSecurity("internal-api-key")
  @UseGuards(CreditsInternalAuthGuard)
  @Post("reconcile/:organizationId")
  reconcile(@Param("organizationId") organizationId: string) {
    return this.creditsService.reconcile(organizationId);
  }
}
