import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { PdpConsolidationService, type PdpConsolidationResult } from "./pdp-consolidation.service";
import type { PdpInvoicingJobPayload } from "./pdp-invoice.service";
import { ETAX_INVOICING_UNITARY, ETAX_REPORTING_PERIODIC, PDP_QUEUE } from "./pdp.constants";

// ADR-107, tranche 2 — le consommateur que PdpModule annonçait comme « la
// tranche suivante ». Wrapper mince, même découpe qu'EtaxSyncProcessor : la
// logique vit dans PdpConsolidationService, testable sans BullMQ ni Redis. Le
// processeur ne fait qu'aiguiller et journaliser.
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
@Processor(PDP_QUEUE)
export class PdpProcessor extends WorkerHost {
  private readonly logger = new Logger(PdpProcessor.name);

  constructor(private readonly consolidation: PdpConsolidationService) {
    super();
  }

  async process(job: Job<PdpInvoicingJobPayload>): Promise<PdpConsolidationResult | null> {
    // ── e-invoicing unitaire (B2B/B2G) ───────────────────────────────────────
    if (job.name === ETAX_INVOICING_UNITARY) {
      const { rawTransactionId, organizationId, clientUniqueId } = job.data;
      // attemptsMade est journalisé : sans lui, une file qui ne réussit qu'à la
      // quatrième tentative ressemble à une file en bonne santé.
      this.logger.log(
        `Consolidation PDP unitaire — document ${clientUniqueId}, ligne ${rawTransactionId}, organisation ${organizationId} (tentative ${job.attemptsMade + 1})`,
      );
      return this.consolidation.consolidateUnitary(job.data);
    }

    // ── e-reporting périodique (B2C / caisses) ───────────────────────────────
    //
    // LA LIGNE RESTE EN `pending`, ET C'EST LE TRAVAIL ATTENDU — pas un trou
    // dans l'implémentation. Ce flux est dû à la DGI sous forme AGRÉGÉE (Z de
    // caisse global) : traiter une micro-vente à l'unité produirait exactement
    // ce que la réglementation ne demande pas, et consommerait un numéro de
    // facture par ticket. La compilation revient à un cron de regroupement
    // distinct, qui reprendra les lignes `pending` du flux e_reporting.
    //
    // La branche existe donc pour NE RIEN FAIRE explicitement. Sans elle, le job
    // que ce cron posera tomberait sur l'UnrecoverableError ci-dessous et
    // mourrait sans réessai — un Z de caisse perdu. Aucun producteur ne l'enfile
    // aujourd'hui (PdpInvoiceService n'enfile que le flux unitaire).
    if (job.name === ETAX_REPORTING_PERIODIC) {
      this.logger.log(
        `Lot e-reporting PDP reçu (tentative ${job.attemptsMade + 1}) — lignes laissées en attente pour la routine de regroupement`,
      );
      return null;
    }

    // Rejouer cinq fois un job qu'on ne sait pas traiter n'a jamais fait
    // apparaître le code manquant : UnrecoverableError coupe le backoff.
    throw new UnrecoverableError(`Job PDP de type inconnu : ${job.name}`);
  }
}
