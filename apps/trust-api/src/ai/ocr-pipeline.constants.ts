// Plan 2026-09-16 (OCR multicanal) — file BullMQ neuve qui porte les trois
// sources asynchrones du Hub Vision (AUDIO_PWA à cette tranche ; WHATSAPP_TEXT
// /WHATSAPP_VOICE dans un lot suivant, MÊME file, MÊME processeur). Le scan
// photo (ADR-122) reste synchrone et ne passe jamais par cette file — voir
// ai.module.ts.

/** Nom de la file BullMQ. Stable : le renommer orphelinerait les jobs en
 *  attente dans Redis au moment du déploiement. */
export const OCR_PIPELINE_QUEUE = "ocr-pipeline";

/** Deux types de job sur la MÊME file, même raisonnement que ETAX_QUEUE
 *  (ETAX_SYNC_JOB / ETAX_INVOICE_JOB) : un seul guichet, un seul profil de
 *  panne, une seule supervision — le prix est que le processeur DOIT
 *  discriminer sur job.name (ocr-pipeline.processor.ts, patron
 *  EtaxSyncProcessor). */
export const OCR_PIPELINE_JOBS = {
  /** AUDIO_PWA / WHATSAPP_VOICE : transcrit (SttProvider) PUIS extrait
   *  (OcrTextExtractionProvider). Seul job traité à cette tranche — voir
   *  ocr-pipeline.processor.ts. */
  TRANSCRIBE_AND_EXTRACT: "transcribe-and-extract",
  /** WHATSAPP_TEXT (lot suivant) : extrait directement depuis
   *  document.textBrut, jamais de transcription. Nom posé ici pour que la
   *  file soit stable dès cette tranche ; non aiguillé avant le lot WhatsApp. */
  EXTRACT_FROM_TEXT: "extract-from-text",
} as const;

export type OcrPipelineJobName = (typeof OCR_PIPELINE_JOBS)[keyof typeof OCR_PIPELINE_JOBS];

/** Charge utile minimale : le document est la source de vérité, le job ne
 *  transporte qu'une référence — même raisonnement que EtaxInvoicePayload,
 *  jamais de montant ni de donnée personnelle dans Redis. */
export type OcrPipelineJobPayload = {
  documentId: string;
  organizationId: string;
  /** Nécessaire à SttProvider pour TRANSCRIBE_AND_EXTRACT — jamais persisté
   *  sur ocr_document (même choix que scanDocumentSchema.mimeType pour la
   *  photo, qui ne survit pas non plus à l'enregistrement) : porté par le job
   *  le temps de son traitement. Absent pour EXTRACT_FROM_TEXT (pas d'audio). */
  mimeType?: string;
};

/** Profil de réessai — délibérément plus court que celui d'eTax
 *  (ETAX_JOB_OPTIONS, 5 tentatives / ~2h35) : eTax n'a personne qui attend une
 *  réponse, un marchand qui a dicté une facture, si. 10 s, 20 s, 40 s — échec
 *  définitif sous la minute et demie. Un hub STT/Vision qui reste indisponible
 *  plus de deux minutes ne se rattrapera pas en s'acharnant davantage ; le
 *  mode de secours (saisie manuelle / renvoi) prend le relais. */
export const OCR_PIPELINE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
} as const;
