import { HttpException, HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import { UnrecoverableError } from "bullmq";
import type { Counter } from "prom-client";
import type { Prisma, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient, setOrganizationScope } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import { EtaxRejetDefinitif } from "../etax/etax.client";
import { InvoicesService } from "../invoices/invoices.service";
import { resolveTaxRateBps } from "../invoices/tax-regime";
import { createPdpInvoiceSchema, type CreatePdpInvoiceDto } from "./dto/create-pdp-invoice.dto";
import type { PdpInvoicingJobPayload } from "./pdp-invoice.service";
import {
  PDP_CONSOLIDATED_METRIC,
  PDP_CONSOLIDATION_FAILURES_METRIC,
} from "./pdp.metrics";

/** Ce que le worker rend à BullMQ. `skipped` distingue un vrai travail d'une
 *  reprise sans effet (job rejoué sur une ligne déjà consolidée) : sans lui, une
 *  file qui ne fait que redécouvrir des doublons ressemble à une file qui
 *  travaille. */
export interface PdpConsolidationResult {
  rawTransactionId: string;
  invoiceId: string | null;
  certificationId: string | null;
  skipped: boolean;
}

// ADR-107, tranche 2 — le worker que le commentaire de PdpModule annonçait.
//
// CE QU'IL FAIT, DANS L'ORDRE : relire la ligne tampon (elle, et jamais le
// payload du job, est la source de vérité), reconstruire la facture depuis le
// document ARCHIVÉ, l'émettre par le chemin d'émission normal — qui la numérote
// Article 23, la certifie Ed25519, la chaîne, ET l'enfile vers le guichet e-TVA
// — puis basculer la ligne tampon en `certified` en y liant la facture finale.
//
// ── LA TRANSMISSION DGI EST ASYNCHRONE, ET CE N'EST PAS UN RACCOURCI ─────────
// Le cahier de cette tranche demandait un appel « immédiat » au service e-TVA.
// Il n'a pas lieu ici, à dessein : InvoicesService.issue() enfile DÉJÀ la
// transmission unitaire (ETAX_INVOICE_JOB, jobId déterministe `invoice-<id>`).
// Appeler EtaxInvoiceService.processTransmission() en plus, en synchrone,
// mettrait les deux chemins en course sur le même document — l'idempotence de
// processTransmission ne lit `etaxStatus === "transmitted"` qu'au DÉBUT, donc
// une facture pourrait partir DEUX FOIS à la DGI. Or « rien ne dit qu'elle
// dédoublonnerait un second envoi » (etax-invoice.service.ts), et une
// transmission fiscale ne se retire pas.
//
// Conséquence à connaître : la taxinomie 503-transitoire / 4xx-définitif du
// guichet vit dans EtaxInvoiceService.processTransmission, où elle est déjà
// écrite, et l'état de la transmission se lit sur Invoice.etaxStatus. La ligne
// tampon, elle, décrit ce que la PASSERELLE a fait du document : reçu
// (`pending`), certifié et remis au circuit e-TVA (`certified`), ou abandonné
// (`failed`). EtaxRejetDefinitif reste néanmoins traité comme définitif plus
// bas — la classification doit rester juste si un jour un chemin synchrone
// remonte jusqu'ici.
//
// RLS (ADR-111) — CARTE DU MODULE. Un job BullMQ n'a NI session, NI RolesGuard,
// NI requête HTTP : rien ne pose de scope pour lui. Chaque accès part donc d'un
// organizationScopedClient, et chaque transaction interactive commence par
// setOrganizationScope — jamais un client nu. L'organisation vient de la LIGNE
// TAMPON relue, dont le payload du job ne fait que donner l'identifiant ; un
// worker ne peut donc pas lire ni écrire les écritures d'un autre NIF, même sur
// un job forgé.
@Injectable()
export class PdpConsolidationService {
  private readonly logger = new Logger(PdpConsolidationService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    private readonly invoices: InvoicesService,
    @InjectMetric(PDP_CONSOLIDATED_METRIC) private readonly consolidated: Counter<string>,
    @InjectMetric(PDP_CONSOLIDATION_FAILURES_METRIC) private readonly failures: Counter<string>,
  ) {}

  /**
   * Traite un job ETAX_INVOICING_UNITARY.
   *
   * LÈVE À DESSEIN sur panne passagère : c'est l'exception qui remonte qui
   * déclenche le backoff exponentiel de la file. L'avaler marquerait le job
   * « completed » alors que rien n'a été certifié.
   */
  async consolidateUnitary(payload: PdpInvoicingJobPayload): Promise<PdpConsolidationResult> {
    const { rawTransactionId, organizationId } = payload;
    const scoped = organizationScopedClient(this.prisma, organizationId);

    // La ligne tampon, jamais le payload du job — même discipline que
    // EtaxSyncService.processDeclaration. Un payload recopié se périme au
    // premier rejeu ; la ligne, elle, porte l'état réel.
    // findFirst et double clause, jamais findUnique sous client scopé.
    const ligne = await scoped.pdpRawTransaction.findFirst({
      where: { id: rawTransactionId, organizationId },
    });

    // Introuvable SOUS CE SCOPE. Deux lectures possibles — ligne supprimée, ou
    // job portant l'organisation d'un autre — et aucune ne s'améliore en
    // rejouant. UnrecoverableError coupe le backoff plutôt que de marteler cinq
    // fois une lecture qui rendra toujours null.
    if (!ligne) {
      throw new UnrecoverableError(
        `Ligne tampon PDP ${rawTransactionId} introuvable pour l'organisation ${organizationId}`,
      );
    }

    // Garde de flux. Un job unitaire sur une ligne e-reporting produirait une
    // facture certifiée là où la DGI attend une agrégation — irréversible.
    if (ligne.flow !== "e_invoicing") {
      throw new UnrecoverableError(
        `Ligne tampon PDP ${rawTransactionId} de flux ${ligne.flow} — seul e_invoicing se consolide unitairement`,
      );
    }

    // ── Idempotence ──────────────────────────────────────────────────────────
    // Un job peut être rejoué après un redémarrage du worker survenu entre
    // l'écriture en base et l'ack Redis. On ne recertifie JAMAIS : une seconde
    // facture consommerait un numéro Article 23 pour le même document ERP.
    if (ligne.status === "certified" && ligne.invoiceId !== null) {
      this.logger.log(`Document PDP ${ligne.clientUniqueId} déjà consolidé — job ignoré`);
      return this.decrire(ligne.id, ligne.invoiceId, ligne.certificationId, true);
    }

    // Abandon déjà consigné : le motif est en base, rejouer le referait
    // seulement échouer. Rendu sans lever — le job est traité, pas en panne.
    if (ligne.status === "failed") {
      this.logger.warn(
        `Document PDP ${ligne.clientUniqueId} déjà abandonné (${ligne.failureReason ?? "motif absent"}) — job ignoré`,
      );
      return this.decrire(ligne.id, ligne.invoiceId, ligne.certificationId, true);
    }

    // ── Reprise après interruption ───────────────────────────────────────────
    // invoiceId est posé AVANT l'émission (voir creerBrouillonLie) : s'il est
    // déjà là, une tentative précédente s'est arrêtée en cours de route et on
    // repart de SA facture. Sans cette reprise, le rejeu créerait un second
    // brouillon et émettrait un SECOND document fiscal pour le même dépôt ERP.
    let invoiceId = ligne.invoiceId;

    try {
      if (invoiceId === null) {
        invoiceId = await this.creerBrouillonLie(ligne);
      }
      const emise = await this.emettre(invoiceId, organizationId);
      await this.marquerConsolidee(ligne.id, organizationId, emise.certificationId);

      this.consolidated.inc();
      this.logger.log(
        `Document PDP ${ligne.clientUniqueId} (organisation ${organizationId}) consolidé — facture ${emise.id}, certification ${emise.certificationId}`,
      );
      return this.decrire(ligne.id, emise.id, emise.certificationId, false);
    } catch (error) {
      const motif = motifDe(error);

      // Panne passagère : AUCUNE écriture d'état. La ligne reste en `pending`,
      // BullMQ rejoue — et si les cinq tentatives s'épuisent, ce `pending` est
      // exactement ce que le rejeu du connecteur reprend tout seul
      // (PdpInvoiceService.surRejeu réenfile une ligne e-invoicing en attente).
      // Écrire `failed` ici fermerait ce rattrapage automatique.
      if (!estRefusDefinitif(error)) {
        throw error;
      }

      await this.marquerEchec(ligne.id, organizationId, invoiceId, ligne.clientUniqueId, motif);
      this.failures.inc({ reason: raisonMetrique(error) });
      // UnrecoverableError : rejouer donnera le même refus, et la ligne porte
      // déjà `failed`. S'acharner ferait attendre le lot d'un connecteur
      // derrière un document que rien ne sauvera.
      throw new UnrecoverableError(
        `Document PDP ${ligne.clientUniqueId} (organisation ${organizationId}) refusé définitivement : ${motif}`,
      );
    }
  }

  // ── Création du brouillon, LIÉ DANS LA MÊME TRANSACTION ────────────────────
  //
  // Le lien pdp_raw_transaction.invoice_id est posé ICI, sur un BROUILLON, et
  // non à la certification comme le laissait entendre le schéma d'origine. Ce
  // n'est pas un détail d'ordonnancement : c'est l'ancre d'idempotence du
  // worker. Un crash entre `invoice.create` et `issue()` laisserait sinon un
  // brouillon orphelin invisible, et le rejeu du job en créerait un second, puis
  // émettrait DEUX factures certifiées pour un seul document ERP. La colonne
  // étant @unique, la base refuse en plus qu'une facture réponde de deux lignes.
  //
  // On n'appelle PAS InvoicesService.createDraft() — et c'est délibéré. Elle
  // applique la convention TTC-first du chemin PWA (totalTtc = Σ quantité ×
  // prix unitaire, puis ventilation HT/TVA dérivée du régime). Or un ERP tiers
  // déclare des prix unitaires HT et un montant de TVA GLOBAL, déjà validés par
  // createPdpInvoiceSchema (totalHT = Σ lignes). Lui passer ces lignes
  // produirait une facture dont le TTC vaudrait le HT déclaré : un document
  // fiscal certifié aux mauvais montants. Les totaux écrits ici sont donc ceux
  // que le connecteur a DÉCLARÉS, repris de la ligne tampon, jamais recalculés.
  //
  // Divergence assumée à connaître : InvoiceLine.unitPrice porte ici un prix HT,
  // là où le chemin PWA y met un prix TTC. Les TOTAUX de la facture restent
  // justes (ce sont eux que la certification signe et que la DGI reçoit) ; c'est
  // le détail ligne à ligne d'un rendu PDF qui ne se resomme pas en TTC. À
  // trancher par ADR avant d'ouvrir la passerelle à un connecteur réel.
  private async creerBrouillonLie(ligne: LigneTampon): Promise<string> {
    const dto = this.relirePayload(ligne);
    const lignes = dto.lines ?? [];

    // Le refine du schéma l'interdit déjà pour b2b/b2g — ce garde couvre le
    // document ARCHIVÉ, qui peut avoir été déposé sous une version antérieure
    // du contrat. Une facture certifiée sans ligne est irrecevable (OHADA
    // Article 23), et rejouer ne la fera pas apparaître.
    if (lignes.length === 0) {
      throw new UnrecoverableError(
        `Document PDP ${ligne.clientUniqueId} sans ligne — aucune facture certifiable (OHADA Article 23)`,
      );
    }

    // Validation comptable, sur la ligne tampon et non sur le DTO : ce sont ces
    // montants-là qui vont être certifiés. BigInt(0) en amorce, jamais le
    // littéral 0n (discipline du module, cf. create-pdp-invoice.dto.ts).
    const sommeLignes = lignes.reduce(
      (total, l) => total + l.unitPrice * BigInt(l.quantity),
      BigInt(0),
    );
    if (sommeLignes !== ligne.totalHtCentimes) {
      throw new UnrecoverableError(
        `Document PDP ${ligne.clientUniqueId} incohérent — Σ lignes ${sommeLignes} ≠ total HT archivé ${ligne.totalHtCentimes}`,
      );
    }
    if (ligne.totalHtCentimes + ligne.totalVatCentimes !== ligne.totalTtcCentimes) {
      throw new UnrecoverableError(
        `Document PDP ${ligne.clientUniqueId} incohérent — HT + TVA ≠ TTC archivé`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // PREMIÈRE ligne du bloc. organizationScopedClient ne convient pas dans une
      // transaction interactive (chaque opération y ouvrirait la sienne).
      await setOrganizationScope(tx, ligne.organizationId);

      const organization = await tx.organization.findFirstOrThrow({
        where: { id: ligne.organizationId },
        select: { regimeFiscal: true },
      });
      const taxRateBps = resolveTaxRateBps(organization.regimeFiscal);
      const customerId = await this.resoudreClient(tx, ligne.organizationId, dto.customer);

      const brouillon = await tx.invoice.create({
        data: {
          organizationId: ligne.organizationId,
          documentType: "invoice",
          // Canal SERVEUR, jamais déclaré par l'appelant (Lot D). `api` est la
          // valeur que le schéma réservait « pour le futur (auth par clé API,
          // F15) » — la passerelle PDP est ce futur.
          emissionChannel: "api",
          status: "draft",
          customerId,
          // Montants DÉCLARÉS par le connecteur, repris tels quels. Voir l'en-tête
          // de cette méthode : aucun recalcul, aucune remise globale sur ce chemin.
          totalHt: ligne.totalHtCentimes,
          totalTva: ligne.totalVatCentimes,
          totalTtc: ligne.totalTtcCentimes,
          amountDue: ligne.totalTtcCentimes,
          // b2g → marché public. La distinction b2b/b2g a été conservée à
          // l'ingestion précisément pour pouvoir la poser ici : écrasée en
          // « standard », le cadre de facturation DGI serait irrécupérable.
          cadreFacturation: dto.transactionType === "b2g" ? "marche_public" : "standard",
          // Références B2G déclaratives, recopiées telles quelles — aucune
          // vérification, le rapprochement est humain (ADR-090 / ADR-109).
          referenceMarche: dto.referenceMarche,
          numeroBonCommande: dto.numeroBonCommande,
          numeroContrat: dto.numeroContrat,
          numeroEngagement: dto.numeroEngagement,
          lines: {
            create: lignes.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              taxRateBps,
            })),
          },
        },
        select: { id: true },
      });

      await tx.pdpRawTransaction.update({
        where: { id: ligne.id },
        data: { invoiceId: brouillon.id },
      });

      return brouillon.id;
    });
  }

  // ── Émission ──────────────────────────────────────────────────────────────
  //
  // Passe par InvoicesService.issue() et rien d'autre : numérotation Article 23
  // sans trou, certification Ed25519, chaînage des hash, enfilement e-TVA. Ces
  // primitives ne se dupliquent pas — une seconde implémentation dériverait, et
  // la chaîne de certification ne pardonne pas une divergence.
  //
  // La relecture préalable n'est pas décorative : elle rattrape le cas où une
  // tentative précédente a émis la facture puis s'est interrompue avant
  // d'écrire la ligne tampon. issue() y répondrait par un 409 « ne peut être
  // émise depuis le statut issued » — un refus définitif qui condamnerait un
  // document pourtant DÉJÀ certifié.
  private async emettre(
    invoiceId: string,
    organizationId: string,
  ): Promise<{ id: string; certificationId: string }> {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const existante = await scoped.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true, status: true, certificationId: true },
    });

    if (!existante) {
      throw new UnrecoverableError(
        `Facture ${invoiceId} liée à la ligne tampon introuvable pour l'organisation ${organizationId}`,
      );
    }

    if (existante.status !== "draft") {
      // Émise par une tentative précédente : on reprend SA certification. Un
      // statut non-brouillon sans certificationId serait une incohérence de base
      // qu'aucun rejeu ne résoudra.
      if (existante.certificationId === null) {
        throw new UnrecoverableError(
          `Facture ${invoiceId} au statut ${existante.status} sans identifiant de certification — incohérence à instruire`,
        );
      }
      this.logger.log(`Facture ${invoiceId} déjà émise par une tentative précédente — certification reprise`);
      return { id: existante.id, certificationId: existante.certificationId };
    }

    const emise = await this.invoices.issue(invoiceId, organizationId);
    if (emise.certificationId === null) {
      throw new UnrecoverableError(
        `Facture ${invoiceId} émise sans identifiant de certification — incohérence à instruire`,
      );
    }
    return { id: emise.id, certificationId: emise.certificationId };
  }

  // ── Bascule de la ligne tampon ────────────────────────────────────────────
  //
  // `certified` et non « CONSOLIDATED » : c'est la valeur que porte l'enum
  // PdpTransactionStatus, et son commentaire de schéma la définit exactement
  // ainsi — « facture émise et certifiée (e-invoicing) ». Inventer une valeur
  // supplémentaire aurait coûté une migration pour un synonyme.
  private async marquerConsolidee(
    rawTransactionId: string,
    organizationId: string,
    certificationId: string,
  ): Promise<void> {
    await organizationScopedClient(this.prisma, organizationId).pdpRawTransaction.update({
      where: { id: rawTransactionId },
      data: {
        status: "certified",
        certificationId,
        processedAt: new Date(),
        // Un abandon antérieur repris avec succès ne doit pas laisser son motif
        // derrière lui : failure_reason n'a de sens que sous `failed`.
        failureReason: null,
      },
    });
  }

  // ── Abandon définitif ─────────────────────────────────────────────────────
  //
  // NE LÈVE JAMAIS : l'appelant a déjà une erreur à remonter, et la masquer par
  // une panne d'écriture ferait perdre la cause — même discipline que
  // EtaxInvoiceService.marquerEchec.
  //
  // Le motif est consigné EN BASE, pas dans le journal : `failure_reason` est le
  // champ que le schéma réserve à ça (« En clair, quand status = failed »), il
  // survit à la rotation des logs et se lit au support sans accès Pino. Un seul
  // `warn` accompagne l'écriture — la tentative fautive est unique par
  // construction (on n'arrive ici que sur refus définitif), donc aucun risque de
  // saturer le journal à coups de cinq lignes par document.
  //
  // L'InvoiceEvent n'est écrit QUE si une facture existe : le journal WORM est
  // indexé par invoice_id, une ligne tampon refusée avant toute création n'a
  // rien à quoi s'accrocher — sa trace, c'est la ligne elle-même.
  private async marquerEchec(
    rawTransactionId: string,
    organizationId: string,
    invoiceId: string | null,
    clientUniqueId: string,
    motif: string,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await setOrganizationScope(tx, organizationId);
        await tx.pdpRawTransaction.update({
          where: { id: rawTransactionId },
          data: { status: "failed", failureReason: motif, processedAt: new Date() },
        });

        if (invoiceId !== null) {
          await tx.invoiceEvent.create({
            data: {
              invoiceId,
              type: "etax_transmission_failed",
              // actorId NULL : personne n'a agi, c'est un worker. Inventer un
              // acteur système rendrait le journal WORM menteur.
              metadata: { cause: motif, clientUniqueId, source: "pdp" },
            },
          });
        }
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Impossible de consigner l'abandon du document PDP ${clientUniqueId} (organisation ${organizationId})`,
        err.stack ?? err.message,
      );
      return;
    }

    this.logger.warn(
      `Document PDP ${clientUniqueId} (organisation ${organizationId}) abandonné définitivement : ${motif}`,
    );
  }

  // Le document ARCHIVÉ, relu par le schéma public — jamais un cast. Le payload
  // a été écrit tel que le connecteur l'a envoyé, avant validation : c'est ce
  // qui fait sa valeur de preuve, et ce qui impose de le re-valider ici. Un
  // document qui ne passe plus le schéma (dérive de contrat, archive corrompue)
  // ne repassera jamais : refus définitif, pas cinq réessais.
  private relirePayload(ligne: LigneTampon): CreatePdpInvoiceDto {
    const parsed = createPdpInvoiceSchema.safeParse(ligne.payload);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Payload archivé du document PDP ${ligne.clientUniqueId} invalide : ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "(racine)"} ${issue.message}`)
          .join(" ; ")}`,
      );
    }
    return parsed.data;
  }

  // Le connecteur envoie des LIBELLÉS, jamais un uuid de notre base (il n'en a
  // aucun) : il faut donc rapprocher, et créer à défaut. Le NIF prime sur le nom
  // — c'est l'identifiant fiscal, un même acheteur peut changer de raison
  // sociale. Sans NIF on retombe sur le nom exact, qui vaut mieux que créer un
  // doublon à chaque facture.
  //
  // Un client anonyme (vente sans acquéreur identifié) reste null, exactement
  // comme Invoice.customerId est nullable — on n'invente pas un « client
  // divers ».
  private async resoudreClient(
    tx: Prisma.TransactionClient,
    organizationId: string,
    customer: CreatePdpInvoiceDto["customer"],
  ): Promise<string | null> {
    if (!customer) {
      return null;
    }

    // Double clause d'organisation, jamais un findUnique : le scope RLS est posé,
    // mais le filtre explicite reste l'invariant du dépôt tant qu'il peut dormir.
    const existant = await tx.customer.findFirst({
      where: customer.nif
        ? { organizationId, nif: customer.nif }
        : { organizationId, name: customer.name },
      select: { id: true },
    });
    if (existant) {
      return existant.id;
    }

    const cree = await tx.customer.create({
      // `address` du payload n'a pas de colonne côté Customer : il reste dans le
      // document archivé, seule source qui en réponde. Ne rien inventer vaut
      // mieux que le loger dans un champ qui ne veut pas dire ça.
      data: { organizationId, name: customer.name, nif: customer.nif ?? null },
      select: { id: true },
    });
    return cree.id;
  }

  private decrire(
    rawTransactionId: string,
    invoiceId: string | null,
    certificationId: string | null,
    skipped: boolean,
  ): PdpConsolidationResult {
    return { rawTransactionId, invoiceId, certificationId, skipped };
  }
}

// Ce que le worker lit de la ligne tampon. Type local plutôt que le type Prisma
// complet : les helpers privés n'ont besoin que de ces champs, et les tests
// unitaires en deviennent lisibles (même parti pris que PdpInvoiceService).
type LigneTampon = {
  id: string;
  organizationId: string;
  clientUniqueId: string;
  totalHtCentimes: bigint;
  totalVatCentimes: bigint;
  totalTtcCentimes: bigint;
  payload: unknown;
};

/**
 * Refus DÉFINITIF = rejouer à l'identique donnera le même refus.
 *
 * LE PARTAGE EST DÉLIBÉRÉMENT ÉTROIT, et c'est le point de cette fonction. Un
 * abandon est TERMINAL : la ligne passe en `failed`, et plus rien ne la reprend
 * — ni BullMQ, ni le rejeu du connecteur (PdpInvoiceService.surRejeu ne réenfile
 * qu'une ligne restée en `pending`). Se tromper dans ce sens condamne un
 * document fiscal ; se tromper dans l'autre coûte cinq réessais et un job dans
 * la file d'échec, d'où la ligne repart au prochain dépôt du connecteur.
 *
 * D'où les exclusions qui surprennent :
 *   • 409 — les conflits d'issue() sont majoritairement REJOUABLES et le disent
 *     (« réessayer » : verrou de ligne expiré P2028, collision d'identifiant de
 *     certification). Les condamner tuerait des factures sur une organisation
 *     simplement chargée.
 *   • 403 — l'émission gelée après récupération de compte est une fenêtre
 *     TEMPORAIRE. La ligne doit rester en `pending` : le gel levé, le prochain
 *     dépôt du connecteur la reprend tout seul.
 *
 * Restent définitifs : ce que le worker a lui-même jugé insoluble
 * (UnrecoverableError), un refus du guichet de l'État (EtaxRejetDefinitif, 4xx
 * hors 429 — classification faite par EtaxClient), et un 400 : un document que
 * la validation refuse ne se corrige pas tout seul.
 */
export function estRefusDefinitif(error: unknown): boolean {
  if (error instanceof UnrecoverableError) {
    return true;
  }
  if (error instanceof EtaxRejetDefinitif) {
    return true;
  }
  if (error instanceof HttpException) {
    return error.getStatus() === HttpStatus.BAD_REQUEST;
  }
  return false;
}

/** Étiquette de la métrique d'échec — jamais le message, qui porte des
 *  identifiants (numéro ERP, uuid) et ferait exploser la cardinalité Prometheus. */
function raisonMetrique(error: unknown): string {
  if (error instanceof EtaxRejetDefinitif) {
    return "rejet_dgi";
  }
  if (error instanceof HttpException) {
    return "document_invalide";
  }
  return "insoluble";
}

/** Le motif TEXTUEL EXACT consigné en base. Le message d'origine, jamais un
 *  résumé : c'est lui que le support lit pour instruire un document fiscal
 *  resté sans suite. */
function motifDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
