import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { OCR_PIPELINE_JOBS, OCR_PIPELINE_QUEUE, type OcrPipelineJobPayload } from "./ocr-pipeline.constants";
import { OcrPipelineService } from "./ocr-pipeline.service";
import type { OcrScanResult } from "./ocr-vision.service";

// Plan 2026-09-16 (OCR multicanal) — wrapper mince, même découpe
// qu'EtaxSyncProcessor : la logique vit dans OcrPipelineService, testable sans
// BullMQ ni Redis. Le processeur ne fait qu'aiguiller et journaliser.
//
// DEUX TYPES DE JOB SUR LA MÊME FILE depuis l'étape 2 (WHATSAPP_TEXT) :
// TRANSCRIBE_AND_EXTRACT (AUDIO_PWA, et WHATSAPP_VOICE à l'étape 3) et
// EXTRACT_FROM_TEXT (WHATSAPP_TEXT). Même raisonnement que EtaxSyncProcessor
// (ETAX_SYNC_JOB/ETAX_INVOICE_JOB) : un nom de job non géré lève
// UnrecoverableError, jamais un job traité à moitié.
//
// Il ne rattrape AUCUNE erreur métier : toute exception qui remonte fait
// échouer le job et déclenche le backoff exponentiel de la file. L'avaler ici
// marquerait le job « completed » alors que rien n'a été transcrit ni extrait
// — exactement la panne silencieuse que la file existe pour empêcher.
// OcrPipelineService, lui, absorbe SEULEMENT l'échec de la DERNIÈRE tentative
// (document → REJECTED, notifié) ; ce résultat-là revient ici comme un succès
// normal du job, pas comme une exception.
@Processor(OCR_PIPELINE_QUEUE)
export class OcrPipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(OcrPipelineProcessor.name);

  constructor(private readonly pipeline: OcrPipelineService) {
    super();
  }

  async process(job: Job<OcrPipelineJobPayload>): Promise<OcrScanResult> {
    const payload = lireCharge(job);

    if (job.name === OCR_PIPELINE_JOBS.TRANSCRIBE_AND_EXTRACT) {
      // attemptsMade est journalisé : sans lui, une file qui ne réussit qu'à
      // la 2e tentative ressemble à une file en bonne santé.
      this.logger.log(
        `Transcription + extraction — document ${payload.documentId}, organisation ${payload.organizationId} (tentative ${job.attemptsMade + 1})`,
      );
      return this.pipeline.transcribeAndExtract(payload, {
        attemptsMade: job.attemptsMade,
        attempts: job.opts?.attempts ?? 1,
      });
    }

    if (job.name === OCR_PIPELINE_JOBS.EXTRACT_FROM_TEXT) {
      this.logger.log(
        `Extraction depuis texte — document ${payload.documentId}, organisation ${payload.organizationId} (tentative ${job.attemptsMade + 1})`,
      );
      return this.pipeline.extractFromText(payload, {
        attemptsMade: job.attemptsMade,
        attempts: job.opts?.attempts ?? 1,
      });
    }

    // Rejouer plusieurs fois un job qu'on ne sait pas traiter n'a jamais fait
    // apparaître le code manquant : UnrecoverableError coupe le backoff.
    throw new UnrecoverableError(`Job ocr-pipeline de type non géré : ${job.name}`);
  }
}

// Une garde, jamais un cast nu — même raisonnement que pdp.processor.ts. Un
// payload forgé ou périmé ne doit pas entrer directement dans une transaction
// qui pose un scope RLS.
function lireCharge(job: Job<unknown>): OcrPipelineJobPayload {
  const candidat = job.data as Partial<OcrPipelineJobPayload> | null;
  if (
    !candidat ||
    typeof candidat.documentId !== "string" ||
    candidat.documentId.trim() === "" ||
    typeof candidat.organizationId !== "string" ||
    candidat.organizationId.trim() === ""
  ) {
    throw new UnrecoverableError(
      `Job ${job.name} sans charge utile exploitable — documentId et organizationId requis`,
    );
  }
  return {
    documentId: candidat.documentId,
    organizationId: candidat.organizationId,
    mimeType: typeof candidat.mimeType === "string" ? candidat.mimeType : undefined,
  };
}
