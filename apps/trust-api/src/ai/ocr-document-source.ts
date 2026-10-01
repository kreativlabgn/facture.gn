import type { EmissionChannel, OcrDocumentSource } from "@facture-gn/db";

// Plan 2026-09-16 (OCR multicanal) — point de convergence des quatre portes
// d'entrée du Hub Vision (ADR-122). Le littéral `emissionChannel: "pwa"` codé
// en dur dans OcrVisionService.traiter() devient cette fonction PURE, lue
// depuis le document déjà chargé : la décision ne dépend d'aucun appel réseau
// ni d'aucun état mutable, seulement de la source posée à l'enregistrement.
//
// IMAGE_SCAN et AUDIO_PWA sont tous deux des actes PWA (photographier ou
// dicter dans l'app authentifiée par JWT) : "pwa". WHATSAPP_VOICE et
// WHATSAPP_TEXT sont tous deux des actes WhatsApp (message entrant sur le
// webhook Meta) : "whatsapp". Exhaustif sur les 4 valeurs — une 5e valeur
// d'OcrDocumentSource fera échouer le typecheck ici, jamais un silence.
export function emissionChannelForSource(source: OcrDocumentSource): EmissionChannel {
  switch (source) {
    case "IMAGE_SCAN":
    case "AUDIO_PWA":
      return "pwa";
    case "WHATSAPP_VOICE":
    case "WHATSAPP_TEXT":
      return "whatsapp";
    default: {
      // Garde d'exhaustivité TypeScript — jamais atteinte tant que
      // OcrDocumentSource compte exactement ces 4 valeurs.
      const exhaustif: never = source;
      throw new Error(`OcrDocumentSource inconnu : ${String(exhaustif)}`);
    }
  }
}
