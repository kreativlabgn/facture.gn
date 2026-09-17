import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { makeCounterProvider } from "@willsoto/nestjs-prometheus";
import { CustomersModule } from "../customers/customers.module";
import { AiController } from "./ai.controller";
import { OCR_PIPELINE_JOB_OPTIONS, OCR_PIPELINE_QUEUE } from "./ocr-pipeline.constants";
import { OCR_PIPELINE_REJECTIONS_METRIC } from "./ocr-pipeline.metrics";
import { OcrPipelineProcessor } from "./ocr-pipeline.processor";
import { OcrPipelineService } from "./ocr-pipeline.service";
import { OCR_TEXT_EXTRACTION_PROVIDER } from "./ocr-text-extraction.provider";
import { OcrValidationService } from "./ocr-validation.service";
import { OCR_VISION_PROVIDER } from "./ocr-vision.provider";
import { OcrVisionService } from "./ocr-vision.service";
import { ocrTextExtractionProviderFromEnv } from "./sovereign-ocr-text-extraction.provider";
import { ocrVisionProviderFromEnv } from "./sovereign-ocr-vision.provider";
import { sttProviderFromEnv } from "./sovereign-stt.provider";
import { STT_PROVIDER } from "./stt.provider";

// Hub de Vision Souveraine (ADR-122) — étendu au multicanal par le plan
// 2026-09-16 : le scan PHOTO reste SYNCHRONE (la PWA attend le verdict pour
// afficher OcrReviewAlert dans la foulée), mais AUDIO_PWA (et WHATSAPP_TEXT/
// WHATSAPP_VOICE, lot suivant) sont ASYNCHRONES — deux appels réseau
// séquentiels (transcription PUIS extraction) doubleraient le risque de
// timeout précisément pour l'usage pensé pour les connexions les plus
// dégradées (clarification 4 du plan). D'où la file ocr-pipeline, MÊME patron
// que ETAX_QUEUE/PDP_QUEUE : connexion Redis fournie par QueueModule (@Global).
//
// OCR_VISION_PROVIDER / STT_PROVIDER / OCR_TEXT_EXTRACTION_PROVIDER sont tous
// résolus par l'environnement, MÊME discipline exacte : endpoint absent →
// implémentation NON CONFIGURÉE (503 explicite) ; endpoint sans jeton → refus
// au démarrage. OCR_TEXT_EXTRACTION_PROVIDER réutilise OCR_VISION_ENDPOINT/
// OCR_VISION_TOKEN (clarification 2 du plan) — zéro variable neuve pour lui.
@Module({
  imports: [
    BullModule.registerQueue({
      name: OCR_PIPELINE_QUEUE,
      defaultJobOptions: { ...OCR_PIPELINE_JOB_OPTIONS },
    }),
    // Plan 2026-09-16 (OCR multicanal), étape 2 — CustomersService.resolveByPhone()
    // (repli de résolution client WhatsApp, ocr-vision.service.ts::traiter()),
    // injecté @Optional() : voir le commentaire du constructeur d'OcrVisionService.
    CustomersModule,
  ],
  controllers: [AiController],
  providers: [
    OcrValidationService,
    OcrVisionService,
    OcrPipelineService,
    OcrPipelineProcessor,
    { provide: OCR_VISION_PROVIDER, useFactory: ocrVisionProviderFromEnv },
    { provide: STT_PROVIDER, useFactory: sttProviderFromEnv },
    { provide: OCR_TEXT_EXTRACTION_PROVIDER, useFactory: ocrTextExtractionProviderFromEnv },
    // Recommandé par docs/runbooks/whatsapp-ocr-channel.md §5 (Observabilité) —
    // voir le commentaire JSDoc d'ocr-pipeline.metrics.ts pour le pourquoi.
    makeCounterProvider({
      name: OCR_PIPELINE_REJECTIONS_METRIC,
      help: "Nombre de documents OCR passés en REJECTED après épuisement des tentatives du pipeline (transcription/extraction)",
      labelNames: ["source"],
    }),
  ],
  exports: [OcrVisionService, OcrValidationService],
})
export class AiModule {}
