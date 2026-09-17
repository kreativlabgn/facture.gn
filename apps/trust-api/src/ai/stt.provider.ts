import { ServiceUnavailableException } from "@nestjs/common";

// Port du modèle de transcription (STT — clarification 2 du plan 2026-09-16,
// OCR multicanal). Même discipline que ocr-vision.provider.ts : le Hub est
// SOUVERAIN (auto-hébergé sur l'infrastructure facture.gn — jamais un SaaS
// tiers, décision explicite du plan §clarification 2b), et trust-api ne
// connaît de lui que cette interface.
//
// Le modèle reçoit une RÉFÉRENCE audio (clé de stockage), jamais les octets —
// même raisonnement que OcrImageRef : trust-api ne fait pas transiter des
// mégaoctets de note vocale à travers son parseur JSON, et le stockage objet
// est la seule pièce qui doit détenir l'audio.

export const STT_PROVIDER = Symbol("STT_PROVIDER");

export type SttAudioRef = {
  storageKey: string;
  mimeType: string;
};

/** Ce que le modèle rend : un identifiant de version (traçabilité de
 *  souveraineté) et le texte transcrit BRUT — jamais interprété ici, c'est
 *  OcrTextExtractionProvider qui en tirera une extraction structurée. */
export type SttResult = {
  modelId: string;
  texte: string;
};

export interface SttProvider {
  transcrire(audio: SttAudioRef): Promise<SttResult>;
}

// Implémentation par défaut tant qu'aucun point de transcription n'est câblé
// (OCR_STT_ENDPOINT absent). Échec = 503 EXPLICITE, jamais un job qui reste
// bloqué sans que personne ne sache qu'aucun modèle n'a été sollicité.
export class UnconfiguredSttProvider implements SttProvider {
  transcrire(): Promise<SttResult> {
    return Promise.reject(
      new ServiceUnavailableException(
        "Hub STT non configuré (plan 2026-09-16) — aucun point de transcription OCR_STT_ENDPOINT n'est défini sur cet environnement",
      ),
    );
  }
}
