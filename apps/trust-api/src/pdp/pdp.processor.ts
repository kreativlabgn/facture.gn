import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { UnrecoverableError, type Job, type Queue } from "bullmq";
import {
  PdpConsolidationService,
  type PdpConsolidationResult,
  type PdpReportingConsolidationResult,
  type PdpReportingJobPayload,
} from "./pdp-consolidation.service";
import type { PdpInvoicingJobPayload } from "./pdp-invoice.service";
import {
  ETAX_INVOICING_UNITARY,
  ETAX_REPORTING_CONSOLIDATION_CRON,
  ETAX_REPORTING_PERIODIC,
  PDP_JOB_OPTIONS,
  PDP_QUEUE,
} from "./pdp.constants";

// ADR-107, tranche 2 puis 3 — le consommateur que PdpModule annonçait. Wrapper
// mince, même découpe qu'EtaxSyncProcessor : la logique vit dans
// PdpConsolidationService, testable sans BullMQ ni Redis. Le processeur ne fait
// qu'aiguiller, enfiler et journaliser.
//
// PDP_QUEUE et non une file nouvelle : c'est le nom que PdpInvoiceService
// alimente déjà (`pdp-ingestion`). En déclarer un autre laisserait les jobs
// déjà déposés dormir dans Redis sans consommateur — un document fiscal accepté
// et jamais certifié, sans le moindre signal.
//
// Il ne rattrape AUCUNE erreur métier : toute exception qui remonte fait échouer
// le job et déclenche le backoff exponentiel de la file (PDP_JOB_OPTIONS, 5
// tentatives). L'avaler ici marquerait le job « completed » alors que rien n'a
// été certifié — exactement la panne silencieuse que la file existe pour
// empêcher.
//
// ── LA SEULE INJECTION DE Queue DU MODULE, ET POURQUOI ELLE EST ICI ──────────
// L'éventail du cron pose des jobs. Ce travail-là est de la plomberie de file,
// pas de la logique métier : le mettre dans PdpConsolidationService y ferait
// entrer Redis et rendrait tout le service inexerçable sans broker. Le partage
// tient donc en une phrase — le SERVICE énumère (une requête, testable), le
// PROCESSEUR enfile.
@Processor(PDP_QUEUE)
export class PdpProcessor extends WorkerHost {
  private readonly logger = new Logger(PdpProcessor.name);

  constructor(
    private readonly consolidation: PdpConsolidationService,
    @InjectQueue(PDP_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async process(
    job: Job<PdpInvoicingJobPayload | PdpReportingJobPayload | Record<string, never>>,
  ): Promise<PdpConsolidationResult | PdpReportingConsolidationResult | PdpFanoutResult | null> {
    // ── e-invoicing unitaire (B2B/B2G) ───────────────────────────────────────
    if (job.name === ETAX_INVOICING_UNITARY) {
      const payload = lireChargeUnitaire(job.data);
      // attemptsMade est journalisé : sans lui, une file qui ne réussit qu'à la
      // quatrième tentative ressemble à une file en bonne santé.
      this.logger.log(
        `Consolidation PDP unitaire — document ${payload.clientUniqueId}, ligne ${payload.rawTransactionId}, organisation ${payload.organizationId} (tentative ${job.attemptsMade + 1})`,
      );
      return this.consolidation.consolidateUnitary(payload);
    }

    // ── L'éventail (cron horaire) ────────────────────────────────────────────
    //
    // NE CONSOLIDE RIEN. Il énumère les organisations qui ont des tickets en
    // attente et pose un job par organisation. Un lot Odoo qui échoue chez une
    // PME ne fait donc jamais attendre les 400 autres, et chaque organisation
    // garde son propre budget de réessais.
    //
    // Rejouable sans dégât : ce job n'écrit RIEN en base. Un rejeu reposera au
    // pire des jobs pour des organisations déjà servies, qui trouveront
    // simplement zéro ticket à compiler (`skipped`).
    if (job.name === ETAX_REPORTING_CONSOLIDATION_CRON) {
      return this.deployerEventail(job.attemptsMade + 1);
    }

    // ── e-reporting périodique (B2C / caisses), UNE organisation ─────────────
    //
    // La branche qui, en tranche 2, ne faisait explicitement rien. Elle fait
    // désormais le travail : verrouiller les tickets en attente, les sommer,
    // émettre le Z de caisse, basculer les lignes tampons. La transmission à la
    // DGI reste ASYNCHRONE — issue() enfile déjà ETAX_INVOICE_JOB, et un second
    // appel synchrone mettrait les deux chemins en course sur le même document.
    if (job.name === ETAX_REPORTING_PERIODIC) {
      const { organizationId } = lireChargeReporting(job.data);
      this.logger.log(
        `Compilation e-reporting PDP — organisation ${organizationId} (tentative ${job.attemptsMade + 1})`,
      );
      return this.consolidation.consolidatePeriodicReporting(organizationId);
    }

    // Rejouer cinq fois un job qu'on ne sait pas traiter n'a jamais fait
    // apparaître le code manquant : UnrecoverableError coupe le backoff.
    throw new UnrecoverableError(`Job PDP de type inconnu : ${job.name}`);
  }

  // Un job par organisation, jobId laissé à BullMQ.
  //
  // PAS DE jobId DÉTERMINISTE ICI, contrairement au chemin unitaire — et ce
  // n'est pas un oubli. Un jobId stable par organisation serait libéré au
  // nettoyage des jobs terminés (removeOnComplete), donc dédoublonnerait de
  // façon imprévisible : parfois oui, parfois non, selon la profondeur de la
  // file. La correction ne vient pas d'ici mais de la base — le
  // `SELECT ... FOR UPDATE` et le prédicat `consolidated_invoice_id IS NULL`
  // font qu'un second job sur la même organisation trouve simplement zéro
  // ticket libre. Deux jobs concurrents ne peuvent pas produire deux Z sur les
  // mêmes ventes, quel que soit leur nombre.
  private async deployerEventail(tentative: number): Promise<PdpFanoutResult> {
    const organizationIds = await this.consolidation.listOrganizationsWithPendingReporting();

    if (organizationIds.length === 0) {
      this.logger.log(
        `Éventail e-reporting PDP (tentative ${tentative}) — aucune organisation à compiler`,
      );
      return { organizationsFanned: 0, enqueueFailures: 0 };
    }

    let enqueueFailures = 0;
    for (const organizationId of organizationIds) {
      const payload: PdpReportingJobPayload = { organizationId };
      try {
        await this.queue.add(ETAX_REPORTING_PERIODIC, payload, { ...PDP_JOB_OPTIONS });
      } catch (error) {
        // UN échec d'enfilement N'INTERROMPT PAS l'éventail. Redis qui refuse un
        // job pour une organisation ne doit pas priver les 399 suivantes de leur
        // compilation ; et comme les tickets restent `pending`, l'organisation
        // manquée est reprise telle quelle au passage suivant.
        enqueueFailures += 1;
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.error(
          `Échec d'enfilement de la compilation e-reporting pour l'organisation ${organizationId} — tickets laissés en attente`,
          err.stack ?? err.message,
        );
      }
    }

    const resultat: PdpFanoutResult = {
      organizationsFanned: organizationIds.length - enqueueFailures,
      enqueueFailures,
    };
    this.logger.log(
      `Éventail e-reporting PDP (tentative ${tentative}) — ${JSON.stringify(resultat)}`,
    );

    // Toutes les organisations perdues = Redis globalement KO. Le job doit
    // ÉCHOUER pour être rejoué : le rendre « completed » ferait passer pour un
    // passage réussi une heure sans aucune compilation.
    if (enqueueFailures > 0 && enqueueFailures === organizationIds.length) {
      throw new Error(
        `Éventail e-reporting : aucune des ${organizationIds.length} organisations n'a pu être enfilée`,
      );
    }

    return resultat;
  }
}

/** Ce que rend un passage d'éventail. `enqueueFailures` non nul = des tickets
 *  restés en attente sans job pour les reprendre — repris au passage suivant, mais
 *  la valeur doit être visible pour qu'on ne prenne pas ce passage pour complet. */
export interface PdpFanoutResult {
  organizationsFanned: number;
  enqueueFailures: number;
}

// ── Lecture des charges utiles ───────────────────────────────────────────────
//
// Des gardes, jamais un cast nu. `job.name` est une chaîne : TypeScript ne peut
// pas en déduire la forme de `job.data`, et laisser passer un payload forgé ou
// périmé le ferait entrer directement dans une transaction qui pose un scope RLS.
// Un organizationId vide y deviendrait une erreur opaque de setOrganizationScope,
// cinq fois de suite ; nommé ici, il coupe le backoff tout de suite.

function lireChargeUnitaire(data: unknown): PdpInvoicingJobPayload {
  const candidat = data as Partial<PdpInvoicingJobPayload> | null;
  if (
    !candidat ||
    typeof candidat.rawTransactionId !== "string" ||
    typeof candidat.organizationId !== "string" ||
    typeof candidat.clientUniqueId !== "string" ||
    candidat.organizationId.trim() === ""
  ) {
    throw new UnrecoverableError(
      `Job ${ETAX_INVOICING_UNITARY} sans charge utile exploitable — rawTransactionId, organizationId et clientUniqueId requis`,
    );
  }
  return {
    rawTransactionId: candidat.rawTransactionId,
    organizationId: candidat.organizationId,
    clientUniqueId: candidat.clientUniqueId,
  };
}

function lireChargeReporting(data: unknown): PdpReportingJobPayload {
  const candidat = data as Partial<PdpReportingJobPayload> | null;
  if (
    !candidat ||
    typeof candidat.organizationId !== "string" ||
    candidat.organizationId.trim() === ""
  ) {
    throw new UnrecoverableError(
      `Job ${ETAX_REPORTING_PERIODIC} sans organizationId — impossible de savoir quelle caisse compiler`,
    );
  }
  return { organizationId: candidat.organizationId };
}
