// Plan 2026-09-16 (OCR multicanal) — métrique d'observabilité recommandée par
// docs/runbooks/whatsapp-ocr-channel.md §5. Même patron que etax.metrics.ts :
// préfixe trust_api_, une constante de nom par compteur, déclarée hors du
// graphe DI (enregistrée par ai.module.ts via makeCounterProvider).
//
// ── POURQUOI CE COMPTEUR EXISTE ──────────────────────────────────────────────
// Quand OcrPipelineService.gererEchec() épuise les tentatives BullMQ, le
// document passe à REJECTED — mais la méthode retourne NORMALEMENT (contrat
// d'échec documenté en tête de ocr-pipeline.service.ts) : le job BullMQ, lui,
// se termine en SUCCÈS. Un dashboard standard de taux d'échec de file BullMQ
// ne voit donc RIEN passer : une panne prolongée du Hub STT/Vision touchant de
// nombreux marchands resterait invisible sans un compteur dédié à ce verdict
// métier. `source` (OcrDocumentSource) plutôt que `reason` ou le nom du job :
// c'est le canal qui souffre (AUDIO_PWA/WHATSAPP_VOICE/WHATSAPP_TEXT) qui
// importe pour trianguler une panne, pas la variante de message d'erreur.
export const OCR_PIPELINE_REJECTIONS_METRIC = "trust_api_ocr_pipeline_jobs_rejected_total";
