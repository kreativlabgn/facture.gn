import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiSecurity, ApiTags } from "@nestjs/swagger";
import { InternalAuthGuard } from "../common/internal-auth.guard";
import { Public } from "../common/public.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { chargeMobileMoneySchema, type ChargeMobileMoneyDto } from "./dto/charge-mobile-money.dto";
import { createPaymentLinkSchema, type CreatePaymentLinkDto } from "./dto/create-payment-link.dto";import { PaymentLinksService } from "./payment-links.service";

@ApiTags("payment-links")
@Controller("payment-links")
export class PaymentLinksController {
  constructor(private readonly paymentLinksService: PaymentLinksService) {}

  // Authentification inter-service (C2 Phase 2a) — appelant légitime : trust-api
  // uniquement, jamais un client final. Clé partagée, jamais mTLS (pas d'infra de
  // certificats), jamais HMAC (pas un webhook tiers non fiable, ADR-082 ne
  // s'applique pas ici). Guard au niveau méthode (pas classe) depuis C19 : cette
  // route reste interne, GET :invoiceId/checkout ci-dessous est publique.
  // @Public() (finding #16) : posture déjà pensée et appliquée via InternalAuthGuard
  // ci-dessus, jamais une vraie ouverture — cette route reste protégée.
  @ApiSecurity("internal-api-key")
  @UseGuards(InternalAuthGuard)
  @Public()
  @Post()
  create(@Body(new ZodValidationPipe(createPaymentLinkSchema)) dto: CreatePaymentLinkDto) {
    return this.paymentLinksService.createPaymentLink(dto.invoiceId, dto.organizationId, dto.amountGnf);
  }

  // C19 — page de pré-checkout publique (apps/web/src/app/pay/[invoiceId]) :
  // montant + frais gateway AVANT de rediriger le payeur vers le provider.
  // Aucun guard : le payeur n'est jamais un client authentifié de facture.gn.
  @Public()
  @Get(":invoiceId/checkout")
  getPublicCheckout(@Param("invoiceId") invoiceId: string) {
    return this.paymentLinksService.getPublicCheckout(invoiceId);
  }

  // Chantier 3 — débit Mobile Money poussé sur le numéro du payeur.
  //
  // PROTÉGÉE, contrairement au GET checkout juste au-dessus, et la différence
  // n'est pas de la timidité : lire un récapitulatif ne coûte rien, déclencher
  // un débit engage l'argent de quelqu'un. L'appelant légitime est le Server
  // Action de apps/web (un serveur, jamais le navigateur du payeur) — la clé
  // inter-service ne quitte donc à aucun moment l'infrastructure.
  //
  // Sans ce guard, la route serait un générateur public de sollicitations
  // Mobile Money : quiconque détient un identifiant de facture ferait sonner
  // n'importe quel téléphone guinéen, autant de fois qu'il le voudrait.
  @ApiSecurity("internal-api-key")
  @UseGuards(InternalAuthGuard)
  @Public()
  @Post(":invoiceId/charge")
  chargeMobileMoney(
    @Param("invoiceId") invoiceId: string,
    @Body(new ZodValidationPipe(chargeMobileMoneySchema)) dto: ChargeMobileMoneyDto,
  ) {
    return this.paymentLinksService.chargeMobileMoney(invoiceId, dto.msisdn, dto.operator);
  }
}