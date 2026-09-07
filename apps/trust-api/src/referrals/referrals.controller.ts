import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { Roles } from "../common/rbac/roles.decorator";
import { OrganizationIdSource } from "../common/rbac/organization-id-source.decorator";
import { ReferralsService } from "./referrals.service";
import { attachReferralSchema, type AttachReferralDto } from "./dto/attach-referral.dto";

// Programme de parrainage entre marchands.
//
// owner/admin seulement : le code engage l'organisation et la prime tombe dans
// son portefeuille. Ce n'est ni du ressort d'un caissier, ni d'un agent terrain.
@ApiTags("referrals")
@ApiBearerAuth()
@Controller("organizations/:id/referrals")
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get()
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  summary(@Param("id") organizationId: string) {
    return this.referralsService.summary(organizationId);
  }

  // Idempotent : réactiver rend le code déjà attribué. Un second code
  // invaliderait tous les partages déjà faits.
  @Post("activate")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  activate(@Param("id") organizationId: string) {
    return this.referralsService.activate(organizationId);
  }

  // Rattache CETTE organisation au parrain dont le code est fourni. Ne verse
  // rien : la prime attend le premier abonnement payant.
  @Post("attach")
  @Roles("owner", "admin")
  @OrganizationIdSource("organization")
  attach(
    @Param("id") organizationId: string,
    @Body(new ZodValidationPipe(attachReferralSchema)) dto: AttachReferralDto,
  ) {
    return this.referralsService.attach(organizationId, dto.code);
  }
}
