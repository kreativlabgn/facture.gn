import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { DisputeStatus, InvoiceStatus, PrismaClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { PaymentProviderRegistryService } from "../payment-orchestrator/provider-registry.service";
import { ProviderResolverService } from "../payment-orchestrator/provider-resolver.service";
import type {
  CreatePaymentLinkResult,
  MobileMoneyOperator,
} from "../payment-orchestrator/provider.interface";
import { evaluerEligibilite, MESSAGE_REFUS, type RefusDePaiement } from "./payment-eligibility";

export interface PublicCheckout {
  provider: string;
  paymentLinkUrl: string | null;
  /** ATTENTION — ce n'est PAS le prix de la marchandise. InvoicesService.issue()
   *  transmet `totalTtc + platformFee` : ce montant porte déjà la commission
   *  facture.gn. Le prix de la marchandise vaut `amountGnf - feePlatformGnf`. */
  amountGnf: bigint;
  feeGatewayGnf: bigint;
  /** Commission facture.gn effectivement prélevée sur cette tentative (ADR-074).
   *  Déjà persistée depuis l'origine ; elle n'était simplement pas exposée, ce
   *  qui laissait le payeur devant un « Montant de la facture » qui n'en était
   *  pas un — la marchandise et notre commission y étaient fondues. */
  feePlatformGnf: bigint;
  expiresAt: Date | null;
  /** Chantier 3 — l'état du DOCUMENT, relu à chaque affichage. Sans lui, le
   *  checkout ne savait rien de la facture : il proposait de régler une facture
   *  annulée ou déjà soldée avec le même entrain. */
  payable: boolean;
  motifRefus: RefusDePaiement | null;
  messageRefus: string | null;
}

export interface MobileMoneyChargeResult {
  providerRef: string;
  /** Toujours `pending` : voir ChargeMobileMoneyResult.status — le débit n'est
   *  acquis qu'après composition du code sur le téléphone, et c'est le webhook
   *  qui fait foi. */
  status: "pending";
  operator: MobileMoneyOperator;
  instruction: string;
  /** Ce qui quitte réellement le compte du payeur : marchandise + commission
   *  facture.gn + frais gateway. */
  totalDebiteGnf: bigint;
}

@Injectable()
export class PaymentLinksService {
  private readonly logger = new Logger(PaymentLinksService.name);

  constructor(
    private readonly registry: PaymentProviderRegistryService,
    private readonly providers: ProviderResolverService,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  createPaymentLink(
    invoiceId: string,
    organizationId: string,
    amountGnf: bigint,
  ): Promise<CreatePaymentLinkResult> {
    return this.registry.resolve({ invoiceId, organizationId, amountGnf });
  }

  // C19 — champs strictement destinés au payeur, jamais invoiceId/organizationId
  // (déjà connus via le lien détenu, pas une fuite mais pas un ajout nécessaire).
  // Toujours la tentative "success" la plus récente — un seul provider gagne
  // normalement, orderBy+findFirst reste déterministe dans le cas contraire.
  async getPublicCheckout(invoiceId: string): Promise<PublicCheckout> {
    const attempt = await this.findLienActif(invoiceId);
    const eligibilite = await this.evaluerFacture(invoiceId);

    return {
      provider: attempt.provider,
      paymentLinkUrl: attempt.paymentLinkUrl,
      amountGnf: attempt.amountGnf,
      feeGatewayGnf: attempt.feeGateway,
      feePlatformGnf: attempt.feePlatform,
      expiresAt: attempt.expiresAt,
      payable: eligibilite.payable,
      motifRefus: eligibilite.motif,
      messageRefus: eligibilite.motif === null ? null : MESSAGE_REFUS[eligibilite.motif],
    };
  }

  // Chantier 3 — débit Mobile Money poussé.
  //
  // SECONDE GARDE, jamais la seule : l'écran a déjà désactivé le bouton sur le
  // `payable` ci-dessus. Ce contrôle-ci existe parce qu'un bouton désactivé dans
  // le DOM se réactive depuis la console du navigateur en trois secondes — c'est
  // ici, avant l'appel au gateway, que le refus a une valeur.
  async chargeMobileMoney(
    invoiceId: string,
    msisdn: string,
    operator: MobileMoneyOperator,
  ): Promise<MobileMoneyChargeResult> {
    const attempt = await this.findLienActif(invoiceId);

    const eligibilite = await this.evaluerFacture(invoiceId);
    if (!eligibilite.payable && eligibilite.motif !== null) {
      // 409 et non 400 : la requête est bien formée, c'est l'état de la facture
      // qui s'y oppose. Le message est celui montré au payeur, mot pour mot — un
      // écran et une API qui expliqueraient différemment le même refus
      // laisseraient le payeur arbitrer entre les deux.
      throw new ConflictException(MESSAGE_REFUS[eligibilite.motif]);
    }

    // Garde de double-débit : un débit déjà en vol pour cette facture interdit
    // d'en pousser un second. RÉSIDU CONNU — sans index unique en base, deux
    // requêtes concurrentes peuvent franchir ce test ensemble. Le correctif
    // durable est un index partiel sur (invoice_id) filtré sur status='pending',
    // qui demande une migration : hors du périmètre de ce lot, et signalé comme
    // tel plutôt que présenté comme réglé.
    const enVol = await this.prisma.paymentProviderAttempt.findFirst({
      where: { invoiceId, status: "pending" },
    });
    if (enVol) {
      throw new ConflictException(
        "Un paiement est déjà en cours pour cette facture. Validez-le sur votre téléphone, ou patientez quelques minutes.",
      );
    }

    const provider = this.providers.resolve(attempt.provider);
    if (!provider?.chargeMobileMoney) {
      // Moneroo n'implémente pas le débit poussé faute de barème de frais connu
      // (voir moneroo-stub.provider.ts) : le lien reste alors le seul chemin.
      throw new ServiceUnavailableException(
        "Le paiement Mobile Money direct n'est pas disponible pour cette facture. Utilisez le lien de paiement.",
      );
    }

    const resultat = await provider.chargeMobileMoney({
      invoiceId,
      msisdn,
      operator,
      amountGnf: attempt.amountGnf,
      idempotencyKey: `${invoiceId}:charge:${msisdn}`,
    });

    // TRANSPARENCE TARIFAIRE (ADR-106) — le gateway doit facturer ce que l'écran
    // a annoncé. S'il rend d'autres frais que ceux affichés au récapitulatif, on
    // n'encaisse pas : le payeur a consenti à un total précis, et un débit
    // supérieur au consentement donné ne se rattrape pas après coup.
    if (resultat.feeGatewayGnf !== attempt.feeGateway) {
      this.logger.error(
        `Frais gateway divergents pour ${invoiceId} : annoncés ${attempt.feeGateway}, ` +
          `facturés ${resultat.feeGatewayGnf} — débit refusé`,
      );
      throw new ConflictException(
        "Les frais annoncés ne correspondent plus à ceux de l'opérateur. Rechargez la page pour voir le montant à jour.",
      );
    }

    if (resultat.status === "failed") {
      throw new ServiceUnavailableException(
        "L'opérateur a refusé la demande de paiement. Vérifiez votre numéro et réessayez.",
      );
    }

    await this.prisma.paymentProviderAttempt.create({
      data: {
        invoiceId,
        provider: attempt.provider,
        // `pending`, et c'est ce qui rend la garde ci-dessus opérante. Jamais
        // `success` : cette tentative n'a rien encaissé, elle a sollicité un
        // téléphone. `getPublicCheckout` ne lit que les `success`, ce qui la
        // laisse hors du récapitulatif — les montants affichés restent ceux du
        // lien d'origine, et non ceux de la dernière sollicitation en date.
        status: "pending",
        providerRef: resultat.providerRef,
        amountGnf: attempt.amountGnf,
        feeGateway: resultat.feeGatewayGnf,
        feePlatform: attempt.feePlatform,
      },
    });

    return {
      providerRef: resultat.providerRef,
      status: "pending",
      operator,
      instruction: resultat.instruction,
      totalDebiteGnf: attempt.amountGnf + resultat.feeGatewayGnf,
    };
  }

  private async findLienActif(invoiceId: string) {
    const attempt = await this.prisma.paymentProviderAttempt.findFirst({
      where: { invoiceId, status: "success" },
      orderBy: { createdAt: "desc" },
    });
    if (!attempt) {
      throw new NotFoundException(`Aucun lien de paiement actif pour la facture ${invoiceId}`);
    }
    return attempt;
  }

  // Une facture absente est traitée comme NON encaissable, jamais comme
  // encaissable par défaut : money-api et trust-api partagent la base mais pas
  // le cycle de vie, et l'absence de ligne ne prouve pas que la facture va bien.
  //
  // RLS — lecture non scopée à dessein : money-api n'a pas d'organisation
  // courante (il sert un payeur anonyme, jamais un membre). La politique
  // `org_isolation` laisse passer tant que `app.current_org_id` n'est pas défini,
  // ce qui est le cas ici. À la bascule du rollout RLS (rôle applicatif
  // non-propriétaire + FORCE ROW LEVEL SECURITY, docs/runbooks/rls-rollout.md),
  // cette lecture rendrait `null` et TOUT paiement serait refusé — panne fermée,
  // pas fuite, mais panne totale. À traiter dans le lot RLS, pas ici.
  private async evaluerFacture(
    invoiceId: string,
  ): Promise<{ payable: boolean; motif: RefusDePaiement | null }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, disputeStatus: true },
    });
    if (!invoice) {
      this.logger.warn(
        `Facture ${invoiceId} introuvable alors qu'une tentative de paiement existe`,
      );
      return { payable: false, motif: "non_encaissable" };
    }
    return evaluerEligibilite(
      invoice.status as InvoiceStatus,
      invoice.disputeStatus as DisputeStatus,
    );
  }
}
