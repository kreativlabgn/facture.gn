import { Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectMetric } from "@willsoto/nestjs-prometheus";
import type { Counter } from "prom-client";
import type { OcrDocumentSource, OcrDocumentStatus, PrismaClient } from "@facture-gn/db";
import { organizationScopedClient } from "@facture-gn/db";
import { PRISMA_CLIENT } from "../common/prisma.module";
import type { NotificationProvider } from "../notifications/notification-provider.interface";
import { SMS_PROVIDER, WHATSAPP_PROVIDER } from "../notifications/notifications.tokens";
import { OCR_PIPELINE_REJECTIONS_METRIC } from "./ocr-pipeline.metrics";
import type { OcrPipelineJobPayload } from "./ocr-pipeline.constants";
import { OCR_TEXT_EXTRACTION_PROVIDER, type OcrTextExtractionProvider } from "./ocr-text-extraction.provider";
import { STT_PROVIDER, type SttProvider } from "./stt.provider";
import { OcrVisionService, type OcrScanResult } from "./ocr-vision.service";

// Plan 2026-09-16 (OCR multicanal) — logique d'orchestration du pipeline
// asynchrone, appelée par OcrPipelineProcessor (wrapper mince, même découpe
// qu'EtaxSyncProcessor : la logique vit ICI, testable sans BullMQ ni Redis).
//
// ── LE CONTRAT D'ÉCHEC, EXACTEMENT ───────────────────────────────────────────
// Une exception TRANSITOIRE (hub STT/Vision indisponible — ServiceUnavailable
// Exception) REMONTE tant qu'il reste des tentatives : c'est elle qui doit
// déclencher le backoff exponentiel de BullMQ (OCR_PIPELINE_JOB_OPTIONS),
// jamais avalée ici. Ce n'est QUE sur la DERNIÈRE tentative (attemptsMade + 1
// >= attempts) que l'échec est absorbé : le document passe à REJECTED avec une
// raison explicite, et une notification best-effort part vers l'uploader —
// exactement le mécanisme de la clarification 3 du plan ("RECEIVED + processedAt:
// null suffit" — REJECTED est déjà le sens "rien n'a pu être lu, à rescanner").
export type OcrPipelineAttempt = {
  /** job.attemptsMade — 0 au premier essai. */
  attemptsMade: number;
  /** Nombre total de tentatives autorisées pour ce job. */
  attempts: number;
};

// ── Notification WhatsApp différenciée par verdict (plan 2026-09-16, étape 2,
// tâche 28) ───────────────────────────────────────────────────────────────
//
// UNIQUEMENT sur le chemin HEUREUX de traiter() (AUTO_INSERTED/
// DRAFT_PENDING_MANUAL_REVIEW/REJECTED-hors-contrat) — l'échec définitif par
// ÉPUISEMENT DES TENTATIVES reste porté par notifierEchecDefinitif() ci-dessous,
// inchangé (message déjà adapté à WhatsApp au même titre qu'au SMS, best-effort
// des deux côtés). RECEIVED n'est jamais atteint après un retour de traiter() —
// présent uniquement pour l'exhaustivité du type (Record<OcrDocumentStatus, …>
// oblige le compilateur à couvrir les 4 valeurs si une 5e apparaît un jour).
const VERDICT_MESSAGES: Record<OcrDocumentStatus, string | null> = {
  RECEIVED: null,
  AUTO_INSERTED:
    "Brouillon créé à partir de votre message. Ouvrez l'application facture.gn pour le relire et le certifier.",
  DRAFT_PENDING_MANUAL_REVIEW:
    "Nous avons bien reçu votre message, mais certains montants doivent être vérifiés avant de créer le brouillon. " +
    "Exemple de message attendu : « Facture pour [client], [quantité] [article] à [prix] GNF ». " +
    "Ouvrez l'application facture.gn pour compléter la saisie.",
  REJECTED:
    "Nous n'avons pas pu comprendre ce message. " +
    "Exemple de message attendu : « Facture pour [client], [quantité] [article] à [prix] GNF ». " +
    "Réessayez, ou saisissez la facture directement dans l'application facture.gn.",
};

@Injectable()
export class OcrPipelineService {
  private readonly logger = new Logger(OcrPipelineService.name);

  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(STT_PROVIDER) private readonly stt: SttProvider,
    @Inject(OCR_TEXT_EXTRACTION_PROVIDER) private readonly textExtraction: OcrTextExtractionProvider,
    private readonly ocrVision: OcrVisionService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: NotificationProvider,
    @Inject(WHATSAPP_PROVIDER) private readonly whatsappProvider: NotificationProvider,
    @InjectMetric(OCR_PIPELINE_REJECTIONS_METRIC) private readonly rejections: Counter<string>,
  ) {}

  // ── TRANSCRIBE_AND_EXTRACT : AUDIO_PWA (et WHATSAPP_VOICE, lot suivant) ────
  //
  // Transcrit SI BESOIN — un document dont `textBrut` est déjà posé (reprise
  // après un échec d'EXTRACTION sur une tentative précédente) ne rappelle pas
  // SttProvider : la transcription, une fois obtenue, est persistée avant
  // même que l'extraction ne soit tentée, pour qu'un réessai reprenne là où il
  // s'est arrêté plutôt que de re-payer un appel réseau déjà réussi.
  async transcribeAndExtract(payload: OcrPipelineJobPayload, tentative: OcrPipelineAttempt): Promise<OcrScanResult> {
    const scoped = organizationScopedClient(this.prisma, payload.organizationId);
    const document = await scoped.ocrDocument.findFirst({
      where: { id: payload.documentId, organizationId: payload.organizationId },
    });
    if (!document) {
      // Le job porte une référence forgée par notre propre enfilement
      // (recevoirAudio) — un document introuvable est une anomalie
      // d'intégrité, pas une panne transitoire du hub STT/Vision.
      throw new NotFoundException(`Document ${payload.documentId} introuvable`);
    }

    try {
      let texte = document.textBrut;
      if (!texte) {
        if (!document.storageKey) {
          throw new Error(`Document ${document.id} sans storageKey — rien à transcrire`);
        }
        if (!payload.mimeType) {
          throw new Error(`Job de transcription pour ${document.id} sans mimeType — charge utile incomplète`);
        }
        const transcription = await this.stt.transcrire({
          storageKey: document.storageKey,
          mimeType: payload.mimeType,
        });
        texte = transcription.texte;
        await scoped.ocrDocument.update({
          where: { id: document.id, organizationId: payload.organizationId },
          data: { textBrut: texte },
        });
      }

      const inference = await this.textExtraction.extraire({ texte });
      const resultat = await this.ocrVision.traiter(document.id, payload.organizationId, {
        modelId: inference.modelId,
        sortie: inference.sortie,
      });
      // Point d'extension WHATSAPP_VOICE (Étape 3, plan 2026-09-16) déjà prêt
      // ici sans rien construire de plus : notifierVerdictWhatsapp() est un
      // no-op pour AUDIO_PWA (source ni WHATSAPP_TEXT ni WHATSAPP_VOICE).
      await this.notifierVerdictWhatsapp(document, resultat);
      return resultat;
    } catch (error) {
      return this.gererEchec(document, payload.organizationId, tentative, error);
    }
  }

  // ── EXTRACT_FROM_TEXT : WHATSAPP_TEXT (plan 2026-09-16, étape 2) ───────────
  //
  // Extrait DIRECTEMENT depuis document.textBrut — JAMAIS SttProvider, jamais
  // de transcription à attendre : le texte WhatsApp est déjà le texte à
  // structurer (posé par OcrVisionService.recevoirMessageWhatsapp() à
  // l'enregistrement). Même contrat d'échec exact que transcribeAndExtract()
  // ci-dessus (gererEchec() partagé, sans aucune modification).
  async extractFromText(payload: OcrPipelineJobPayload, tentative: OcrPipelineAttempt): Promise<OcrScanResult> {
    const scoped = organizationScopedClient(this.prisma, payload.organizationId);
    const document = await scoped.ocrDocument.findFirst({
      where: { id: payload.documentId, organizationId: payload.organizationId },
    });
    if (!document) {
      // Le job porte une référence forgée par notre propre enfilement
      // (recevoirMessageWhatsapp) — un document introuvable est une anomalie
      // d'intégrité, pas une panne transitoire du Hub Vision.
      throw new NotFoundException(`Document ${payload.documentId} introuvable`);
    }

    try {
      if (!document.textBrut) {
        // Anomalie d'intégrité, pas une panne transitoire : recevoirMessageWhatsapp()
        // pose TOUJOURS textBrut pour kind:"text" AVANT d'enfiler EXTRACT_FROM_TEXT.
        throw new Error(`Document ${document.id} sans textBrut — rien à extraire`);
      }

      const inference = await this.textExtraction.extraire({ texte: document.textBrut });
      const resultat = await this.ocrVision.traiter(document.id, payload.organizationId, {
        modelId: inference.modelId,
        sortie: inference.sortie,
      });
      await this.notifierVerdictWhatsapp(document, resultat);
      return resultat;
    } catch (error) {
      return this.gererEchec(document, payload.organizationId, tentative, error);
    }
  }

  // ── Notification WhatsApp différenciée par verdict, best-effort ───────────
  //
  // UNIQUEMENT pour WHATSAPP_TEXT/WHATSAPP_VOICE, vers document.customerPhone
  // (le numéro EXACT de l'expéditeur, jamais l'indirection par
  // uploadedByUserId→UserPhone.isPrimary qu'utilise notifierEchecDefinitif() —
  // ici la conversation WhatsApp active EST ce numéro, y répondre ailleurs
  // serait une réponse au mauvais fil pour un utilisateur multi-numéros).
  // Jamais pour IMAGE_SCAN/AUDIO_PWA (customerPhone toujours null, aucune
  // conversation WhatsApp à laquelle répondre).
  private async notifierVerdictWhatsapp(
    document: { source: OcrDocumentSource; customerPhone: string | null },
    resultat: OcrScanResult,
  ): Promise<void> {
    if (document.source !== "WHATSAPP_TEXT" && document.source !== "WHATSAPP_VOICE") {
      return;
    }
    if (!document.customerPhone) {
      this.logger.warn(`Document WhatsApp ${resultat.documentId} sans customerPhone — aucune réponse envoyée`);
      return;
    }
    const message = VERDICT_MESSAGES[resultat.status];
    if (!message) {
      return;
    }
    try {
      await this.whatsappProvider.send(document.customerPhone, message);
    } catch (err) {
      this.logger.warn(`Échec d'envoi de la réponse WhatsApp différenciée : ${(err as Error).message}`);
    }
  }

  // ── Épuisement des tentatives, ou remontée pour backoff ────────────────────
  private async gererEchec(
    document: { id: string; uploadedByUserId: string; source: OcrDocumentSource },
    organizationId: string,
    tentative: OcrPipelineAttempt,
    error: unknown,
  ): Promise<OcrScanResult> {
    const derniereTentative = tentative.attemptsMade + 1 >= tentative.attempts;
    if (!derniereTentative) {
      // JAMAIS avalée avant l'épuisement : c'est cette exception qui fait
      // échouer le job et déclenche le backoff exponentiel de la file.
      throw error;
    }

    const raison = `Transcription impossible après ${tentative.attempts} tentatives — reprenez la note vocale ou saisissez la facture manuellement`;
    this.logger.warn(
      `Document ${document.id} rejeté après épuisement des tentatives (${tentative.attempts}) — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    const scoped = organizationScopedClient(this.prisma, organizationId);
    const rejete = await scoped.ocrDocument.update({
      where: { id: document.id, organizationId },
      data: { status: "REJECTED", rejectionReason: raison, processedAt: new Date() },
    });

    // Le job BullMQ, lui, se termine en SUCCÈS (gererEchec() ne relève pas
    // l'exception une fois les tentatives épuisées — voir le contrat d'échec
    // en tête de fichier) : sans ce compteur, aucun dashboard de file ne voit
    // ce verdict métier passer. Voir ocr-pipeline.metrics.ts.
    this.rejections.inc({ source: document.source });

    await this.notifierEchecDefinitif(document, organizationId, raison);

    return {
      documentId: rejete.id,
      status: rejete.status,
      invoiceId: rejete.invoiceId,
      findings: null,
      rejectionReason: rejete.rejectionReason,
    };
  }

  // Meilleur effort — même garantie que PaymentReminderService.send() : un
  // échec d'envoi ne remonte jamais, le document reste REJECTED (déjà écrit
  // en base) que la notification parte ou non.
  private async notifierEchecDefinitif(
    document: { uploadedByUserId: string },
    organizationId: string,
    message: string,
  ): Promise<void> {
    const scoped = organizationScopedClient(this.prisma, organizationId);
    const phone = await scoped.userPhone.findFirst({
      where: { userId: document.uploadedByUserId, isPrimary: true },
    });
    if (!phone) {
      this.logger.warn(`Aucun numéro primaire pour notifier l'uploader ${document.uploadedByUserId} de l'échec`);
      return;
    }

    await Promise.all(
      [this.smsProvider, this.whatsappProvider].map(async (provider) => {
        try {
          await provider.send(phone.msisdn, message);
        } catch (err) {
          this.logger.warn(`Échec d'envoi de la notification de rejet : ${(err as Error).message}`);
        }
      }),
    );
  }
}
