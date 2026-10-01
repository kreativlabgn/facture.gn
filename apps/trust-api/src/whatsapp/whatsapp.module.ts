import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { AiModule } from "../ai/ai.module";
import { OCR_PIPELINE_QUEUE } from "../ai/ocr-pipeline.constants";
import { WhatsAppAbuseGuardService } from "./whatsapp-abuse-guard.service";
import { WhatsAppInboundController } from "./whatsapp-inbound.controller";
import { WhatsAppInboundService } from "./whatsapp-inbound.service";
import { WHATSAPP_MEDIA_RELAY, whatsAppMediaRelayFromEnv } from "./whatsapp-media-relay.service";
import { WhatsAppWebhookAuthGuard } from "./whatsapp-webhook-auth.guard";

// Plan 2026-09-16 (OCR multicanal), étape 2 — assemble le guichet WhatsApp
// entrant : contrôleur, garde de signature, résolution expéditeur/opt-in/
// anti-abus, dispatch vers OcrVisionService (AiModule, déjà exporté).
//
// WhatsAppWebhookAuthGuard EN PROVIDER (pas seulement référencé par
// @UseGuards()) — même patron exact que PartnerWebhookAuthGuard/PartnersModule :
// Nest l'instancie au bootstrap du module, ce qui fait échouer le démarrage
// fail-fast si WHATSAPP_APP_SECRET est absent, plutôt qu'au premier webhook reçu.
//
// BullModule.registerQueue({ name: OCR_PIPELINE_QUEUE }) SANS defaultJobOptions
// (déjà posés par AiModule) — même patron exact que HealthModule/
// RedisHealthIndicator (money-api) : donne à WhatsAppAbuseGuardService accès à
// la connexion ioredis DÉJÀ configurée pour la file ocr-pipeline
// (queue.client), JAMAIS une seconde connexion Redis dédiée.
@Module({
  imports: [AiModule, BullModule.registerQueue({ name: OCR_PIPELINE_QUEUE })],
  controllers: [WhatsAppInboundController],
  providers: [
    WhatsAppWebhookAuthGuard,
    WhatsAppAbuseGuardService,
    WhatsAppInboundService,
    // Étape 3 du plan 2026-09-16 — même discipline d'usine que OCR_VISION_PROVIDER/
    // STT_PROVIDER (ai.module.ts) : configuration STORAGE_*/WHATSAPP_ACCESS_TOKEN
    // absente → implémentation non configurée (échec prévisible limité à la
    // branche audio, voir whatsapp-media-relay.service.ts), jamais un refus au
    // démarrage de tout trust-api.
    { provide: WHATSAPP_MEDIA_RELAY, useFactory: whatsAppMediaRelayFromEnv },
  ],
})
export class WhatsAppModule {}
