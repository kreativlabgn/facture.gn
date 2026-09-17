import { Logger, ServiceUnavailableException } from "@nestjs/common";
import type { OcrTextExtractionProvider, OcrTextInference, OcrTextRef } from "./ocr-text-extraction.provider";
import { UnconfiguredOcrTextExtractionProvider } from "./ocr-text-extraction.provider";

// Connecteur LIVE du second point d'entrée du HUB VISION SOUVERAIN (ADR-122,
// clarification 2 du plan 2026-09-16) — réutilise OCR_VISION_ENDPOINT et
// OCR_VISION_TOKEN tels quels, sous-chemin `/extractions/text` au lieu de
// `/extractions` : un modèle de langage capable de structurer une facture
// depuis une image en sait généralement tout autant depuis un texte. Ce
// n'est pas un second modèle à héberger, c'est un second point d'entrée du
// même modèle — zéro variable d'environnement neuve à provisionner pour ce
// fichier.
//
// ── CE QUI PART : LE TEXTE, JAMAIS D'IMAGE ──────────────────────────────────
// Le texte vient soit d'un message WhatsApp tapé directement, soit d'une
// transcription (SttProvider) — jamais de clé de stockage ici, contrairement
// à sovereign-ocr-vision.provider.ts : il n'y a pas d'octets binaires à
// référencer, le texte tient dans le corps JSON.
//
// ── CE QUI REVIENT : UNE ENVELOPPE VÉRIFIÉE, UNE LECTURE NON JUGÉE ──────────
// Même enveloppe { modelId, extraction } que la vision, même garantie :
// ocrExtractionSchema, dans OcrVisionService.traiter(), reste l'unique
// validateur de l'extraction elle-même.
//
// ── ÉCHEC = 503 ───────────────────────────────────────────────────────────
type OcrTextInferenceEnvelope = {
  modelId: string;
  extraction: unknown;
};

/** Budget du WORKER (pipeline asynchrone, clarification 4 du plan) — même
 *  ordre de grandeur que la vision, un texte étant plus rapide à structurer
 *  qu'une image à lire. */
export const OCR_TEXT_EXTRACTION_REQUEST_TIMEOUT_MS = 20_000;

export type SovereignOcrTextExtractionConfig = {
  endpoint: string;
  token: string;
};

export class SovereignOcrTextExtractionProvider implements OcrTextExtractionProvider {
  private readonly logger = new Logger(SovereignOcrTextExtractionProvider.name);

  constructor(private readonly config: SovereignOcrTextExtractionConfig) {}

  async extraire(texte: OcrTextRef): Promise<OcrTextInference> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCR_TEXT_EXTRACTION_REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(`${this.config.endpoint}/extractions/text`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${this.config.token}`,
          },
          body: JSON.stringify({ texte: texte.texte }),
          signal: controller.signal,
        });
      } catch (error) {
        const cause = error instanceof Error && error.name === "AbortError" ? "délai dépassé" : "injoignable";
        this.logger.warn(`Hub Vision (extraction texte) ${cause} (${OCR_TEXT_EXTRACTION_REQUEST_TIMEOUT_MS} ms)`);
        throw new ServiceUnavailableException(`Hub Vision ${cause} — l'extraction est à rejouer`);
      }

      if (!response.ok) {
        this.logger.warn(`Hub Vision (extraction texte) a répondu ${response.status}`);
        throw new ServiceUnavailableException(`Hub Vision a répondu ${response.status} — l'extraction est à rejouer`);
      }

      const enveloppe = await response.json().catch(() => null);
      if (!estEnveloppe(enveloppe)) {
        this.logger.warn("Hub Vision (extraction texte) a rendu une enveloppe sans modelId");
        throw new ServiceUnavailableException("Hub Vision a rendu une réponse sans identifiant de modèle — l'extraction est à rejouer");
      }
      return { modelId: enveloppe.modelId, sortie: enveloppe.extraction };
    } finally {
      clearTimeout(timer);
    }
  }
}

function estEnveloppe(valeur: unknown): valeur is OcrTextInferenceEnvelope {
  return (
    typeof valeur === "object" &&
    valeur !== null &&
    typeof (valeur as { modelId?: unknown }).modelId === "string" &&
    (valeur as { modelId: string }).modelId.length > 0 &&
    "extraction" in valeur
  );
}

// ── Fabrique par environnement ───────────────────────────────────────────────
//
// RÉUTILISE OCR_VISION_ENDPOINT/OCR_VISION_TOKEN — pas de variable neuve
// (clarification 2 du plan). Même patron exact que ocrVisionProviderFromEnv().
export function ocrTextExtractionProviderFromEnv(env: NodeJS.ProcessEnv = process.env): OcrTextExtractionProvider {
  const endpoint = env.OCR_VISION_ENDPOINT?.trim();
  if (!endpoint) {
    return new UnconfiguredOcrTextExtractionProvider();
  }
  const token = env.OCR_VISION_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "OCR_VISION_ENDPOINT est défini mais OCR_VISION_TOKEN est vide — le Hub Vision refuse de démarrer à moitié configuré (ADR-122)",
    );
  }
  return new SovereignOcrTextExtractionProvider({ endpoint: endpoint.replace(/\/+$/, ""), token });
}
