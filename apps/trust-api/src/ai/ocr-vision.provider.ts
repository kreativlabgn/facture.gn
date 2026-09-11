import { ServiceUnavailableException } from "@nestjs/common";

// Port du modèle de vision (ADR-122). Le Hub est SOUVERAIN : le modèle tourne
// sur une infrastructure que facture.gn contrôle, et trust-api ne connaît de
// lui que cette interface. Aucun SDK d'éditeur, aucune clé d'API tierce ne
// traverse ce module.
//
// Le modèle reçoit une RÉFÉRENCE d'image (clé de stockage), jamais les octets :
// trust-api ne fait pas transiter des mégaoctets de photos à travers son
// parseur JSON (limite Express 100 ko, main.ts), et le stockage objet est la
// seule pièce qui doit détenir l'image. La photo est déposée par la PWA
// directement dans le stockage ; le serveur n'en manipule que l'empreinte.

export const OCR_VISION_PROVIDER = Symbol("OCR_VISION_PROVIDER");

export type OcrImageRef = {
  storageKey: string;
  mimeType: string;
};

/** Ce que le modèle rend : un identifiant de version (traçabilité de
 *  souveraineté — quel poids a lu ce document) et sa sortie BRUTE, `unknown`
 *  jusqu'à ce que ocrExtractionSchema l'ait validée. Typer `sortie` plus fort
 *  ici reviendrait à faire confiance au modèle avant de l'avoir vérifié. */
export type OcrInference = {
  modelId: string;
  sortie: unknown;
};

export interface OcrVisionProvider {
  extraire(image: OcrImageRef): Promise<OcrInference>;
}

// Implémentation par défaut tant qu'aucun point d'inférence n'est câblé
// (OCR_VISION_ENDPOINT absent). Même principe que la passerelle PDP à sa
// tranche 1 — « porte ouverte sans worker derrière » — mais ici la porte
// répond 503 EXPLICITE : un scan ne doit jamais rester en RECEIVED sans que
// l'appelant sache qu'aucun modèle n'a été sollicité. Le registre, la
// validation et l'insertion sont eux entièrement opérationnels et testés ;
// seul l'appel réseau au modèle manque.
export class UnconfiguredOcrVisionProvider implements OcrVisionProvider {
  extraire(): Promise<OcrInference> {
    return Promise.reject(
      new ServiceUnavailableException(
        "Hub Vision non configuré (ADR-122) — aucun point d'inférence OCR_VISION_ENDPOINT n'est défini sur cet environnement",
      ),
    );
  }
}
