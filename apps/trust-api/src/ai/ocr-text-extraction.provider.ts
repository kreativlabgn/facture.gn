import { ServiceUnavailableException } from "@nestjs/common";

// Port du modèle d'extraction depuis un TEXTE (clarification 2 du plan
// 2026-09-16, OCR multicanal) — le second des deux ports neufs que le pipeline
// texte ajoute par rapport à la photo (qui lit ET structure en un seul appel
// de vision). Appelé pour les TROIS sources textuelles : WHATSAPP_TEXT
// directement, AUDIO_PWA/WHATSAPP_VOICE après transcription (SttProvider).
//
// Même hub que la vision (OCR_VISION_ENDPOINT/OCR_VISION_TOKEN, réutilisés
// tels quels — voir sovereign-ocr-text-extraction.provider.ts), sous-chemin
// neuf : ce n'est pas un second modèle à héberger, c'est un second point
// d'entrée du même modèle. La question de souveraineté est déjà tranchée par
// ADR-122 pour ce hub ; ce fichier ne la rouvre pas.

export const OCR_TEXT_EXTRACTION_PROVIDER = Symbol("OCR_TEXT_EXTRACTION_PROVIDER");

export type OcrTextRef = {
  texte: string;
};

/** Même forme que OcrInference (ocr-vision.provider.ts) : un identifiant de
 *  modèle et une sortie BRUTE, `unknown` jusqu'à ce que ocrExtractionSchema
 *  l'ait validée. */
export type OcrTextInference = {
  modelId: string;
  sortie: unknown;
};

export interface OcrTextExtractionProvider {
  extraire(texte: OcrTextRef): Promise<OcrTextInference>;
}

// Implémentation par défaut tant qu'aucun point d'inférence n'est câblé
// (OCR_VISION_ENDPOINT absent — même variable que la vision, voir
// sovereign-ocr-text-extraction.provider.ts). Échec = 503 EXPLICITE.
export class UnconfiguredOcrTextExtractionProvider implements OcrTextExtractionProvider {
  extraire(): Promise<OcrTextInference> {
    return Promise.reject(
      new ServiceUnavailableException(
        "Hub Vision non configuré (plan 2026-09-16) — aucun point d'inférence OCR_VISION_ENDPOINT n'est défini sur cet environnement",
      ),
    );
  }
}
