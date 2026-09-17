import { Logger, ServiceUnavailableException } from "@nestjs/common";
import type { SttAudioRef, SttProvider, SttResult } from "./stt.provider";
import { UnconfiguredSttProvider } from "./stt.provider";

// Connecteur LIVE du Hub STT Souverain (plan 2026-09-16, OCR multicanal) —
// copie quasi ligne à ligne de sovereign-ocr-vision.provider.ts, même
// discipline exacte : l'appel HTTP au point de transcription que facture.gn
// héberge lui-même (clarification 2b — jamais un SaaS tiers, positionnement
// "tiers de confiance privé certifié" non négociable, CLAUDE.md).
//
// ── CE QUI PART : UNE RÉFÉRENCE, PAS LES OCTETS ──────────────────────────────
// La PWA dépose la note vocale directement dans le stockage objet souverain et
// ne transmet à trust-api que sa clé (scan-audio.dto.ts). Le connecteur relaie
// cette clé au modèle, qui va lire l'audio dans CE stockage.
//
// ── CE QUI REVIENT : UNE ENVELOPPE VÉRIFIÉE, UNE LECTURE NON JUGÉE ──────────
// Le connecteur exige l'enveloppe { modelId, texte } — sans modelId, la
// traçabilité de souveraineté serait perdue. Il ne valide PAS le texte
// lui-même : c'est OcrTextExtractionProvider, puis ocrExtractionSchema, qui le
// confrontent au contrat.
//
// ── ÉCHEC = 503, JAMAIS UN JOB QUI RESTE BLOQUÉ SILENCIEUSEMENT ──────────────
// Panne réseau, délai dépassé, statut non-2xx, enveloppe malformée : le
// connecteur lève ServiceUnavailableException — c'est cette exception qui
// remonte au processeur BullMQ et déclenche le backoff (OCR_PIPELINE_JOB_OPTIONS).

/** Nom du modèle tel que déclaré par le point de transcription. */
type SttEnvelope = {
  modelId: string;
  texte: string;
};

/** Budget du WORKER, pas de la requête utilisateur (contrairement à
 *  OCR_VISION_REQUEST_TIMEOUT_MS) : AUDIO_PWA est asynchrone (clarification 4
 *  du plan) — personne n'attend cette réponse sur une connexion HTTP ouverte.
 *  30 s laisse le temps à un modèle Whisper auto-hébergé de transcrire une
 *  note vocale de facture, sans bloquer indéfiniment un worker si le hub est
 *  dégradé plutôt que mort. */
export const OCR_STT_REQUEST_TIMEOUT_MS = 30_000;

export type SovereignSttConfig = {
  endpoint: string;
  token: string;
};

export class SovereignSttProvider implements SttProvider {
  private readonly logger = new Logger(SovereignSttProvider.name);

  constructor(private readonly config: SovereignSttConfig) {}

  async transcrire(audio: SttAudioRef): Promise<SttResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCR_STT_REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(`${this.config.endpoint}/transcriptions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${this.config.token}`,
          },
          body: JSON.stringify({ storageKey: audio.storageKey, mimeType: audio.mimeType }),
          signal: controller.signal,
        });
      } catch (error) {
        const cause = error instanceof Error && error.name === "AbortError" ? "délai dépassé" : "injoignable";
        this.logger.warn(`Hub STT ${cause} (${OCR_STT_REQUEST_TIMEOUT_MS} ms) pour la clé ${audio.storageKey}`);
        throw new ServiceUnavailableException(`Hub STT ${cause} — la transcription est à rejouer`);
      }

      if (!response.ok) {
        this.logger.warn(`Hub STT a répondu ${response.status} pour la clé ${audio.storageKey}`);
        throw new ServiceUnavailableException(`Hub STT a répondu ${response.status} — la transcription est à rejouer`);
      }

      const enveloppe = await response.json().catch(() => null);
      if (!estEnveloppe(enveloppe)) {
        this.logger.warn(`Hub STT a rendu une enveloppe incomplète pour la clé ${audio.storageKey}`);
        throw new ServiceUnavailableException(
          "Hub STT a rendu une réponse sans identifiant de modèle ou sans texte — la transcription est à rejouer",
        );
      }
      return { modelId: enveloppe.modelId, texte: enveloppe.texte };
    } finally {
      clearTimeout(timer);
    }
  }
}

function estEnveloppe(valeur: unknown): valeur is SttEnvelope {
  return (
    typeof valeur === "object" &&
    valeur !== null &&
    typeof (valeur as { modelId?: unknown }).modelId === "string" &&
    (valeur as { modelId: string }).modelId.length > 0 &&
    typeof (valeur as { texte?: unknown }).texte === "string"
  );
}

// ── Fabrique par environnement ───────────────────────────────────────────────
//
// Même patron exact que ocrVisionProviderFromEnv() : OCR_STT_ENDPOINT absent →
// implémentation NON CONFIGURÉE (503 explicite). Endpoint présent sans jeton →
// refus au DÉMARRAGE, pas au premier job — une configuration à moitié faite se
// voit dans les journaux de déploiement, pas dans le 503 d'un commerçant.
export function sttProviderFromEnv(env: NodeJS.ProcessEnv = process.env): SttProvider {
  const endpoint = env.OCR_STT_ENDPOINT?.trim();
  if (!endpoint) {
    return new UnconfiguredSttProvider();
  }
  const token = env.OCR_STT_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "OCR_STT_ENDPOINT est défini mais OCR_STT_TOKEN est vide — le Hub STT refuse de démarrer à moitié configuré (plan 2026-09-16)",
    );
  }
  // Sans barre finale : le connecteur suffixe `/transcriptions`.
  return new SovereignSttProvider({ endpoint: endpoint.replace(/\/+$/, ""), token });
}
