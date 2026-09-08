import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { ETAX_INVOICE_JOB, ETAX_QUEUE, ETAX_SYNC_JOB } from "./etax.constants";
import type { EtaxDeclarationPayload } from "./etax-declaration";
import type { EtaxInvoicePayload } from "./etax-invoice";
import { EtaxInvoiceService } from "./etax-invoice.service";
import { EtaxSyncService } from "./etax-sync.service";

// Chantier 5, étape 3 — wrapper mince, même découpe que RetentionProcessor : la
// logique vit dans les services, testables sans BullMQ ni Redis. Le processeur
// ne fait qu'aiguiller et journaliser.
//
// DEUX TYPES DE JOB SUR LA MÊME FILE depuis la transmission unitaire (LFI 2025).
// L'aiguillage sur job.name n'est donc pas décoratif : sans lui, une facture
// serait traitée comme une déclaration d'exercice — payload incompatible, erreur
// obscure, et cinq réessais pour rien. Un nom inconnu lève un UnrecoverableError
// plutôt qu'une erreur ordinaire : rejouer cinq fois un job qu'on ne sait pas
// traiter n'a jamais fait apparaître le code manquant.
//
// Il ne rattrape AUCUNE erreur métier : toute exception qui remonte fait échouer
// le job et déclenche le backoff exponentiel de la file. L'avaler ici marquerait
// le job « completed » alors que la DGI n'a rien reçu — exactement ce que la
// résilience est censée empêcher.
@Processor(ETAX_QUEUE)
export class EtaxSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(EtaxSyncProcessor.name);

  constructor(
    private readonly etaxSyncService: EtaxSyncService,
    private readonly etaxInvoiceService: EtaxInvoiceService,
  ) {
    super();
  }

  async process(
    job: Job<EtaxDeclarationPayload | EtaxInvoicePayload>,
  ): Promise<{ submissionRef?: string; receiptNumber?: string; skipped: boolean }> {
    if (job.name === ETAX_SYNC_JOB) {
      const { organizationId, year } = job.data as EtaxDeclarationPayload;
      // attemptsMade est journalisé : sans lui, une file qui réussit toujours à
      // la 4e tentative ressemble à une file en bonne santé.
      this.logger.log(
        `Déclaration eTax — exercice ${year}, organisation ${organizationId} (tentative ${job.attemptsMade + 1})`,
      );
      return this.etaxSyncService.processDeclaration(job.data as EtaxDeclarationPayload);
    }

    if (job.name === ETAX_INVOICE_JOB) {
      const { invoiceId, organizationId } = job.data as EtaxInvoicePayload;
      this.logger.log(
        `Transmission e-TVA — facture ${invoiceId}, organisation ${organizationId} (tentative ${job.attemptsMade + 1})`,
      );
      return this.etaxInvoiceService.processTransmission(job.data as EtaxInvoicePayload);
    }

    throw new UnrecoverableError(`Job eTax de type inconnu : ${job.name}`);
  }
}
