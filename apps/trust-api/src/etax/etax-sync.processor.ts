import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { ETAX_QUEUE } from "./etax.constants";
import type { EtaxDeclarationPayload } from "./etax-declaration";
import { EtaxSyncService } from "./etax-sync.service";

// Chantier 5, étape 3 — wrapper mince, même découpe que RetentionProcessor : la
// logique vit dans EtaxSyncService, testable sans BullMQ ni Redis. Le processeur
// ne fait que déclencher et journaliser.
//
// Il ne rattrape AUCUNE erreur : toute exception qui remonte fait échouer le job
// et déclenche le backoff exponentiel de la file. L'avaler ici marquerait le job
// « completed » alors que la DGI n'a rien reçu — exactement ce que la résilience
// est censée empêcher.
@Processor(ETAX_QUEUE)
export class EtaxSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(EtaxSyncProcessor.name);

  constructor(private readonly etaxSyncService: EtaxSyncService) {
    super();
  }

  async process(job: Job<EtaxDeclarationPayload>): Promise<{ submissionRef: string; skipped: boolean }> {
    const { organizationId, year } = job.data;
    // attemptsMade est journalisé : sans lui, une file qui réussit toujours à la
    // 4e tentative ressemble à une file en bonne santé.
    this.logger.log(
      `Déclaration eTax — exercice ${year}, organisation ${organizationId} (tentative ${job.attemptsMade + 1})`,
    );
    return this.etaxSyncService.processDeclaration(job.data);
  }
}
