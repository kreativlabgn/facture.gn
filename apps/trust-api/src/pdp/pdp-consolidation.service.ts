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
import { PdpReportingNumberingService } from "./pdp-reporting-numbering.service";
import { PDP_REPORTING_BATCH_MAX, PDP_REPORTING_FANOUT_MAX } from "./pdp.constants";
import {
  PDP_CONSOLIDATED_METRIC,
  PDP_CONSOLIDATION_FAILURES_METRIC,
  PDP_REPORTING_BATCHES_METRIC,
  PDP_REPORTING_TICKETS_METRIC,
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

/** Charge utile d'un job ETAX_REPORTING_PERIODIC — un organizationId, rien de
 *  plus, même discipline que PdpInvoicingJobPayload. Les lignes tampons sont la
 *  source de vérité ; le job n'est qu'un déclencheur, et un payload gras se
 *  périmerait au premier rejeu. */
export interface PdpReportingJobPayload {
  organizationId: string;
}

/** Ce qu'un passage de consolidation périodique rend.
 *
 *  Les totaux sont RENDUS, et pas seulement journalisés : c'est ce que le test
 *  d'intégration compare au centime près, et ce qu'un opérateur lit dans le
 *  retour du job pour rapprocher un Z de ses tickets sans requête SQL. */
export interface PdpReportingConsolidationResult {
  organizationId: string;
  invoiceId: string | null;
  certificationId: string | null;
  /** ZR-YYYY-NNNNNN — la série dédiée, distincte du numéro légal Article 23. */
  reportingSeriesNumber: string | null;
  /** Nombre de micro-ventes embarquées dans ce Z. */
  ticketCount: number;
  totalHtCentimes: bigint;
  totalVatCentimes: bigint;
  /** true = rien à compiler pour cette organisation, aucune facture émise. */
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
    private readonly reportingNumbering: PdpReportingNumberingService,
    @InjectMetric(PDP_CONSOLIDATED_METRIC) private readonly consolidated: Counter<string>,
    @InjectMetric(PDP_CONSOLIDATION_FAILURES_METRIC) private readonly failures: Counter<string>,
    @InjectMetric(PDP_REPORTING_BATCHES_METRIC) private readonly reportingBatches: Counter<string>,
    @InjectMetric(PDP_REPORTING_TICKETS_METRIC) private readonly reportingTickets: Counter<string>,
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

  // ══════════════════════════════════════════════════════════════════════════
  // e-REPORTING PÉRIODIQUE (B2C / CAISSES) — ADR-107 tranche 3, LFI 2025
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Les organisations qui ont réellement des tickets à compiler.
   *
   * LECTURE VOLONTAIREMENT TRANSVERSE — la seule de tout ce module, et il faut
   * savoir pourquoi elle l'est. Le cron d'éventail doit décider QUELS locataires
   * visiter : la question précède le scope, elle ne peut pas être posée depuis
   * l'intérieur d'un scope. Trois choses la rendent tenable :
   *
   *   • elle ne rend que des identifiants d'organisation. Aucun montant, aucun
   *     client, aucune référence de marché ne traverse cette requête ;
   *   • chaque job qu'elle produit REENTRE sous scope strict
   *     (consolidatePeriodicReporting pose setOrganizationScope en première
   *     ligne de chacune de ses transactions) ;
   *   • le résultat n'est jamais rendu à un appelant HTTP — il ne sort pas du
   *     processeur.
   *
   * `organization` N'EST PAS BALAYÉE. Le modèle ne porte aucune colonne
   * « active », et lire tous les locataires pour n'en retenir qu'une poignée
   * coûterait plus cher que le travail lui-même. « Active » se lit ici au seul
   * sens qui compte pour ce cron : « a des lignes e-reporting en attente » —
   * servi par l'index (organization_id, flow, status) posé pour ça.
   *
   * Littéraux d'enum CASTÉS (`'e_reporting'::"PdpFlow"`), jamais paramétrés : un
   * paramètre Prisma arrive en `text`, et Postgres refuse `PdpFlow = text`.
   */
  async listOrganizationsWithPendingReporting(
    limit: number = PDP_REPORTING_FANOUT_MAX,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ organization_id: string }[]>`
      SELECT DISTINCT organization_id
      FROM pdp_raw_transaction
      WHERE flow = 'e_reporting'::"PdpFlow"
        AND status = 'pending'::"PdpTransactionStatus"
      ORDER BY organization_id
      LIMIT ${limit}
    `;
    return rows.map((row) => row.organization_id);
  }

  /**
   * Compile les micro-ventes de caisse en attente d'UNE organisation en un Z de
   * caisse unique, certifié et remis au circuit e-TVA.
   *
   * ── POURQUOI TROIS TRANSACTIONS ET PAS UNE ────────────────────────────────
   * InvoicesService.issue() OUVRE SA PROPRE TRANSACTION. Envelopper la sélection
   * verrouillée et l'émission dans un seul $transaction serait une transaction
   * imbriquée — Prisma ne le permet pas, et le découpage n'est donc pas un
   * choix. Chaque coupure est en revanche un point de reprise explicite :
   *
   *   TX-A  verrou + somme + brouillon Z + rattachement des tickets + n° ZR
   *   TX-B  issue() — n° Article 23, Ed25519, chaînage, enfilement e-TVA
   *   TX-C  bascule des tickets en `certified`
   *
   * Une interruption entre A et B laisse des tickets `pending` DÉJÀ RATTACHÉS au
   * brouillon : le passage suivant les retrouve par ce rattachement et REPREND ce
   * Z-là (ouvrirOuReprendreLot), au lieu d'en ouvrir un second sur les mêmes
   * ventes. Une interruption entre B et C laisse un Z émis et des tickets encore
   * `pending` : emettre() relit la facture, la voit hors `draft`, et reprend SA
   * certification plutôt que d'en demander une seconde.
   *
   * LÈVE À DESSEIN sur panne passagère — c'est l'exception qui remonte qui
   * déclenche le backoff de la file. L'avaler marquerait le job « completed »
   * alors qu'aucun Z n'a été certifié.
   */
  async consolidatePeriodicReporting(
    organizationId: string,
  ): Promise<PdpReportingConsolidationResult> {
    const lot = await this.ouvrirOuReprendreLot(organizationId);

    // Rien en attente : le cas NORMAL sur une organisation sans caisse, et sur
    // toutes celles que l'éventail vient déjà de vider. Aucune facture, aucun
    // numéro consommé.
    if (lot === null) {
      return this.decrireLot(organizationId, null, null, null, 0, BigInt(0), BigInt(0), true);
    }

    try {
      const emise = await this.emettre(lot.invoiceId, organizationId);
      const bascules = await this.marquerLotConsolide(
        organizationId,
        lot.invoiceId,
        emise.certificationId,
      );

      this.reportingBatches.inc();
      this.reportingTickets.inc(bascules);
      this.logger.log(
        `Z de caisse ${lot.reportingSeriesNumber ?? "(série absente)"} certifié pour l'organisation ${organizationId} — ` +
          `${bascules} ticket(s) consolidé(s), facture ${emise.id}, certification ${emise.certificationId}` +
          (lot.reprise ? " (lot repris après interruption)" : ""),
      );

      return this.decrireLot(
        organizationId,
        emise.id,
        emise.certificationId,
        lot.reportingSeriesNumber,
        bascules,
        lot.totalHtCentimes,
        lot.totalVatCentimes,
        false,
      );
    } catch (error) {
      const motif = motifDe(error);

      // Panne passagère : AUCUNE écriture d'état. Les tickets restent `pending`,
      // rattachés au brouillon — c'est exactement ce que la reprise ci-dessus
      // attend. Écrire `failed` ici condamnerait tout un lot de caisse pour un
      // Redis qui tousse ou un verrou expiré.
      if (!estRefusDefinitif(error)) {
        throw error;
      }

      const abandonnes = await this.marquerLotEchoue(organizationId, lot.invoiceId, motif);
      this.failures.inc({ reason: raisonMetrique(error) });
      throw new UnrecoverableError(
        `Z de caisse de l'organisation ${organizationId} refusé définitivement (${abandonnes} ticket(s) abandonné(s)) : ${motif}`,
      );
    }
  }

  // ── TX-A : verrou, sommation, brouillon Z ─────────────────────────────────
  //
  // Rend `null` quand il n'y a rien à compiler — jamais une exception : une
  // organisation sans vente de caisse depuis la dernière heure est le cas
  // nominal, pas une anomalie.
  private async ouvrirOuReprendreLot(organizationId: string): Promise<LotReporting | null> {
    return this.prisma.$transaction(async (tx) => {
      // PREMIÈRE ligne du bloc, sans exception. Ce processus n'a NI session, NI
      // RolesGuard, NI requête HTTP : rien ne pose de scope pour lui, et une
      // sommation de TVA qui déborderait sur un autre NIF est irrattrapable une
      // fois certifiée.
      await setOrganizationScope(tx, organizationId);

      // ── Reprise d'un lot interrompu ────────────────────────────────────────
      // Des tickets `pending` DÉJÀ rattachés à un brouillon : une tentative
      // précédente s'est arrêtée entre TX-A et TX-C. On repart de SON Z.
      const rattaches = await tx.pdpRawTransaction.findMany({
        where: {
          organizationId,
          flow: "e_reporting",
          status: "pending",
          consolidatedInvoiceId: { not: null },
        },
        select: { id: true, consolidatedInvoiceId: true, totalHtCentimes: true, totalVatCentimes: true },
        orderBy: { receivedAt: "asc" },
      });

      if (rattaches.length > 0) {
        return this.reprendreLot(tx, organizationId, rattaches);
      }

      // ── Sélection VERROUILLÉE ──────────────────────────────────────────────
      //
      // SELECT ... FOR UPDATE en SQL brut : Prisma n'expose aucun verrou de
      // ligne, et sans lui deux passages concurrents (cron rejoué, deux
      // instances du worker) embarqueraient les mêmes tickets dans deux Z
      // distincts — la même TVA déclarée deux fois à la DGI.
      //
      // Le verrou porte AUSSI le filtre organisation, comme dans
      // InvoicesService.issue() : sous RLS appliqué la politique le ferait, mais
      // tant qu'elle dort ce SQL brut verrouillerait sinon les tickets d'un
      // autre locataire.
      //
      // `consolidated_invoice_id IS NULL` n'est pas redondant avec la reprise
      // ci-dessus : c'est ce prédicat qui garantit qu'un ticket déjà embarqué
      // dans un Z en cours ne peut pas être ramassé une seconde fois, y compris
      // par une transaction qui aurait démarré avant lui.
      //
      // ORDER BY received_at, id : deux passages concurrents prennent les lignes
      // dans le MÊME ordre. Sans cela, deux verrous croisés se bloquent
      // mutuellement et Postgres tue l'un des deux en deadlock.
      const verrouillees = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM pdp_raw_transaction
        WHERE organization_id = ${organizationId}
          AND flow = 'e_reporting'::"PdpFlow"
          AND status = 'pending'::"PdpTransactionStatus"
          AND consolidated_invoice_id IS NULL
        ORDER BY received_at, id
        LIMIT ${PDP_REPORTING_BATCH_MAX}
        FOR UPDATE
      `;

      if (verrouillees.length === 0) {
        return null;
      }

      const ids = verrouillees.map((row) => row.id);
      const tickets = await tx.pdpRawTransaction.findMany({
        where: { id: { in: ids }, organizationId },
        select: {
          id: true,
          totalHtCentimes: true,
          totalVatCentimes: true,
          totalTtcCentimes: true,
          receivedAt: true,
        },
        orderBy: { receivedAt: "asc" },
      });

      const { totalHtCentimes, totalVatCentimes } = sommerTickets(tickets);

      // « Si la somme des transactions PENDING est supérieure à zéro » — le Z
      // n'est émis QUE dans ce cas. Un lot intégralement à zéro (caisse de test,
      // connecteur mal configuré) ne consomme ni numéro Article 23 ni rang de
      // série. Les tickets restent `pending`, non rattachés : le passage suivant
      // les reverra, et l'avertissement horaire est le signal qui fait remonter
      // le connecteur fautif. Les basculer en `certified` serait pire — ce serait
      // déclarer à la DGI un reporting qui n'a jamais eu lieu.
      if (totalHtCentimes + totalVatCentimes === BigInt(0)) {
        this.logger.warn(
          `Organisation ${organizationId} — ${tickets.length} ticket(s) e-reporting en attente pour un total nul, aucun Z émis`,
        );
        return null;
      }

      const organization = await tx.organization.findFirstOrThrow({
        where: { id: organizationId },
        select: { regimeFiscal: true },
      });

      // Le rang de série AVANT la création : il fait partie du document, et le
      // consommer dans cette transaction garantit qu'un rollback le rend. Un
      // rang consommé hors transaction serait un trou définitif dans la suite
      // des Z — voir la note de PdpReportingNumberingService sur `tx`.
      const reportingSeriesNumber = await this.reportingNumbering.nextNumber(
        organizationId,
        new Date().getFullYear(),
        tx,
      );

      const brouillon = await tx.invoice.create({
        data: {
          organizationId,
          documentType: "invoice",
          // Canal SERVEUR, jamais déclaré par l'appelant — identique au chemin
          // unitaire : ce document vient de l'API, pas d'un comptoir.
          emissionChannel: "api",
          status: "draft",
          // Ventes de caisse ANONYMES. On n'invente pas un « client divers » :
          // Invoice.customerId est nullable précisément pour ce cas.
          customerId: null,
          totalHt: totalHtCentimes,
          totalTva: totalVatCentimes,
          totalTtc: totalHtCentimes + totalVatCentimes,
          amountDue: totalHtCentimes + totalVatCentimes,
          cadreFacturation: "standard",
          reportingSeriesNumber,
          lines: {
            create: [
              {
                description: decrireSynthese(reportingSeriesNumber, tickets),
                quantity: 1,
                // Prix unitaire HORS TAXES — d'où le HT_FIRST juste en dessous.
                unitPrice: totalHtCentimes,
                taxRateBps: resolveTaxRateBps(organization.regimeFiscal),
                // ADR-108. Le cahier demandait ce drapeau « dans la table
                // Invoice » ; la colonne vit sur invoice_line, où elle décrit la
                // PROVENANCE du prix unitaire ci-dessus. Sans lui, le rendu PDF
                // intitulerait « P.U. TTC » un montant HT et afficherait un
                // sous-total TTC qui vaudrait le HT — exactement l'écart visuel
                // que l'ADR-108 supprime.
                saisieRegime: "HT_FIRST",
              },
            ],
          },
        },
        select: { id: true },
      });

      // LE RATTACHEMENT EST POSÉ ICI, SUR LE BROUILLON. C'est l'ancre
      // d'idempotence du lot, exactement comme invoiceId l'est pour le chemin
      // unitaire : sans elle, une interruption avant la certification laisserait
      // un brouillon orphelin invisible et le passage suivant émettrait un
      // SECOND Z sur les mêmes ventes — la même TVA déclarée deux fois.
      await tx.pdpRawTransaction.updateMany({
        where: { id: { in: ids }, organizationId },
        data: { consolidatedInvoiceId: brouillon.id },
      });

      return {
        invoiceId: brouillon.id,
        reportingSeriesNumber,
        totalHtCentimes,
        totalVatCentimes,
        ticketCount: tickets.length,
        reprise: false,
      };
    });
  }

  // Reprise : les tickets sont déjà rattachés, le Z existe. On ne recalcule pas
  // depuis zéro — on resomme CES tickets-là, et on relit le numéro de série sur
  // la facture plutôt que d'en consommer un second.
  private async reprendreLot(
    tx: Prisma.TransactionClient,
    organizationId: string,
    rattaches: { id: string; consolidatedInvoiceId: string | null; totalHtCentimes: bigint; totalVatCentimes: bigint }[],
  ): Promise<LotReporting> {
    // Tous rattachés au MÊME Z par construction (la sélection exclut les lignes
    // déjà rattachées, donc un seul lot peut être en vol). Si ce n'était pas le
    // cas, poursuivre mélangerait deux Z : refus définitif, pas cinq réessais.
    const invoiceIds = [...new Set(rattaches.map((ligne) => ligne.consolidatedInvoiceId))];
    const invoiceId = invoiceIds[0];
    if (invoiceIds.length > 1 || invoiceId === null || invoiceId === undefined) {
      throw new UnrecoverableError(
        `Organisation ${organizationId} — tickets e-reporting en attente rattachés à ${invoiceIds.length} factures de synthèse distinctes, incohérence à instruire`,
      );
    }

    const facture = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { reportingSeriesNumber: true },
    });

    const { totalHtCentimes, totalVatCentimes } = sommerTickets(rattaches);
    this.logger.log(
      `Organisation ${organizationId} — reprise du Z de caisse ${facture?.reportingSeriesNumber ?? invoiceId} interrompu (${rattaches.length} ticket(s))`,
    );

    return {
      invoiceId,
      reportingSeriesNumber: facture?.reportingSeriesNumber ?? null,
      totalHtCentimes,
      totalVatCentimes,
      ticketCount: rattaches.length,
      reprise: true,
    };
  }

  // ── TX-C : bascule des tickets ────────────────────────────────────────────
  //
  // `certified` et non « CONSOLIDATED » : c'est la valeur que porte l'enum
  // PdpTransactionStatus, dont le commentaire de schéma la définit déjà comme
  // « facture émise et certifiée (e-invoicing) OU ligne intégrée à un Z de caisse
  // (e-reporting) ». Inventer un synonyme aurait coûté une migration d'enum.
  //
  // Le `where` porte sur le rattachement, pas sur la liste d'identifiants : un
  // ticket qu'une transaction concurrente aurait accroché à ce même Z est
  // basculé lui aussi, et un rejeu de TX-C ne bascule rien (le filtre `pending`
  // ne matche plus). Rend le nombre de lignes réellement basculées — c'est lui
  // qui alimente la métrique, jamais une estimation.
  private async marquerLotConsolide(
    organizationId: string,
    invoiceId: string,
    certificationId: string,
  ): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      await setOrganizationScope(tx, organizationId);
      const bascules = await tx.pdpRawTransaction.updateMany({
        where: { organizationId, consolidatedInvoiceId: invoiceId, status: "pending" },
        data: {
          status: "certified",
          certificationId,
          processedAt: new Date(),
          // Un abandon antérieur repris avec succès ne doit pas laisser son motif
          // derrière lui : failure_reason n'a de sens que sous `failed`.
          failureReason: null,
        },
      });
      return bascules.count;
    });
  }

  // ── Abandon définitif d'un LOT ────────────────────────────────────────────
  //
  // NE LÈVE JAMAIS, même discipline que marquerEchec : l'appelant a déjà une
  // erreur à remonter, et la masquer par une panne d'écriture ferait perdre la
  // cause.
  //
  // C'est l'écriture la plus lourde de conséquences de tout le module : jusqu'à
  // PDP_REPORTING_BATCH_MAX tickets passent en `failed`, état TERMINAL que plus
  // rien ne reprend. D'où le `error` et non un `warn` — contrairement au chemin
  // unitaire, où un abandon ne concerne qu'un document.
  private async marquerLotEchoue(
    organizationId: string,
    invoiceId: string,
    motif: string,
  ): Promise<number> {
    let abandonnes = 0;
    try {
      abandonnes = await this.prisma.$transaction(async (tx) => {
        await setOrganizationScope(tx, organizationId);
        const echoues = await tx.pdpRawTransaction.updateMany({
          where: { organizationId, consolidatedInvoiceId: invoiceId, status: "pending" },
          data: { status: "failed", failureReason: motif, processedAt: new Date() },
        });

        // Le brouillon Z existe toujours (le rattachement est posé avant
        // l'émission) : le journal WORM a donc bien un invoice_id auquel
        // s'accrocher, contrairement au chemin unitaire où la facture peut
        // n'avoir jamais été créée.
        await tx.invoiceEvent.create({
          data: {
            invoiceId,
            type: "etax_transmission_failed",
            // actorId NULL : personne n'a agi, c'est un cron.
            metadata: { cause: motif, source: "pdp", flow: "e_reporting", tickets: echoues.count },
          },
        });

        return echoues.count;
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Impossible de consigner l'abandon du Z de caisse ${invoiceId} (organisation ${organizationId})`,
        err.stack ?? err.message,
      );
      return 0;
    }

    this.logger.error(
      `Z de caisse ${invoiceId} (organisation ${organizationId}) abandonné définitivement — ${abandonnes} ticket(s) de caisse ne seront JAMAIS déclarés sans intervention : ${motif}`,
    );
    return abandonnes;
  }

  private decrireLot(
    organizationId: string,
    invoiceId: string | null,
    certificationId: string | null,
    reportingSeriesNumber: string | null,
    ticketCount: number,
    totalHtCentimes: bigint,
    totalVatCentimes: bigint,
    skipped: boolean,
  ): PdpReportingConsolidationResult {
    return {
      organizationId,
      invoiceId,
      certificationId,
      reportingSeriesNumber,
      ticketCount,
      totalHtCentimes,
      totalVatCentimes,
      skipped,
    };
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
              // ADR-108 — CE QUI REND LA DIVERGENCE LISIBLE. unitPrice est ici un
              // prix HORS TAXES (standard des ERP tiers), là où le parcours
              // marchand y met un TTC. Sans ce marquage, le rendu PDF
              // intitulerait « P.U. TTC » un montant HT et sommerait les lignes
              // en un « Sous-total TTC » qui vaudrait le HT — exactement le
              // micro-écart visuel que l'ADR-108 supprime.
              saisieRegime: "HT_FIRST",
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

/** Un lot de caisse en vol : le Z ouvert, et ce qu'il embarque. Type local, comme
 *  LigneTampon ci-dessus — les helpers n'ont besoin que de ça, et les tests
 *  unitaires en deviennent lisibles. */
type LotReporting = {
  invoiceId: string;
  reportingSeriesNumber: string | null;
  totalHtCentimes: bigint;
  totalVatCentimes: bigint;
  ticketCount: number;
  /** true = lot repris après une interruption, jamais ouvert par ce passage. */
  reprise: boolean;
};

/**
 * La sommation du lot. C'est LA ligne de code que le cahier des charges décrit,
 * et tout y est délibéré.
 *
 * BigInt(0) EN AMORCE, JAMAIS LE LITTÉRAL `0n` — discipline de bout en bout du
 * module (voir pdp-amounts.ts) : trust-api compile en ES2022, mais un helper qui
 * migrerait vers apps/web (cible ES2017) se transformerait en erreur de syntaxe.
 *
 * ET SURTOUT : AUCUN NOMBRE FLOTTANT N'INTERVIENT, à aucun moment. Les colonnes
 * sont des BIGINT Postgres, Prisma les rend en bigint JavaScript, et l'addition
 * reste entière du premier au dernier ticket. Un `reduce` sur des `Number`
 * dériverait au-delà de 2^53 centimes — soit ~90 milliards de GNF, un chiffre
 * d'affaires de caisse annuel parfaitement atteignable — et la dérive serait
 * SIGNÉE dans le hash de certification, donc indétectable après coup.
 *
 * On somme les colonnes TYPÉES, pas les payloads archivés. Les deux sont
 * équivalents (les colonnes sont la projection produite par toCentimes() à
 * l'ingestion, sans flottant intermédiaire), mais rejouer 5 000 payloads dans Zod
 * coûterait le lot entier si UN seul ticket avait été déposé sous une version
 * antérieure du contrat — un centime perdu vaut mieux qu'un Z perdu, et ici on ne
 * perd même pas le centime.
 */
function sommerTickets(
  tickets: { totalHtCentimes: bigint; totalVatCentimes: bigint }[],
): { totalHtCentimes: bigint; totalVatCentimes: bigint } {
  let totalHtCentimes = BigInt(0);
  let totalVatCentimes = BigInt(0);
  for (const ticket of tickets) {
    totalHtCentimes += ticket.totalHtCentimes;
    totalVatCentimes += ticket.totalVatCentimes;
  }
  return { totalHtCentimes, totalVatCentimes };
}

/** Le libellé de l'unique ligne du Z. Il porte le rang de série et les bornes
 *  réelles du lot — c'est ce que lit un contrôleur qui rapproche le Z des tickets,
 *  et la seule information de périmètre visible sur le PDF.
 *
 *  Les bornes sont les dates de RÉCEPTION par la passerelle, pas les dates
 *  d'émission déclarées par l'ERP : ce sont les seules dont nous répondons. */
function decrireSynthese(
  reportingSeriesNumber: string,
  tickets: { receivedAt: Date }[],
): string {
  const bornes = tickets.map((ticket) => ticket.receivedAt.getTime());
  const debut = new Date(Math.min(...bornes)).toISOString();
  const fin = new Date(Math.max(...bornes)).toISOString();
  return `Ventes de caisse consolidées (e-Reporting ${reportingSeriesNumber}) — ${tickets.length} ticket(s), du ${debut} au ${fin}`;
}

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
