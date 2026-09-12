import { Logger, ServiceUnavailableException } from "@nestjs/common";
import type { OcrImageRef, OcrInference, OcrVisionProvider } from "./ocr-vision.provider";
import { UnconfiguredOcrVisionProvider } from "./ocr-vision.provider";

// Connecteur LIVE du Hub Vision Souveraine (ADR-122) : l'appel HTTP au point
// d'inférence que facture.gn héberge. C'est la seule pièce de ce module qui
// parle réseau, et elle ne connaît du modèle que deux choses — son URL et son
// jeton — lues à la construction, jamais au fil des requêtes.
//
// ── CE QUI PART : UNE RÉFÉRENCE, PAS LES OCTETS ──────────────────────────────
// La PWA dépose la photo directement dans le stockage objet souverain et ne
// transmet à trust-api que sa clé (scan-document.dto.ts). Le connecteur
// relaie cette clé au modèle, qui va lire l'image dans CE stockage : trust-api
// ne détient aucun client de stockage, et sa limite JSON de 100 ko (main.ts)
// est là précisément pour qu'aucune image ne transite par son parseur. Faire
// suivre les octets ici obligerait le serveur à télécharger chaque photo pour
// la ré-envoyer — deux transferts pour rien, et une copie de plus d'un document
// qui contient le nom d'un client.
//
// ── CE QUI REVIENT : UNE ENVELOPPE VÉRIFIÉE, UNE LECTURE NON JUGÉE ──────────
// Le connecteur exige l'enveloppe { modelId, extraction } — sans modelId, la
// traçabilité de souveraineté (quel poids a lu ce document) serait perdue. Il
// ne valide PAS l'extraction elle-même : c'est ocrExtractionSchema, dans
// OcrVisionService.traiter(), qui la confronte au contrat (montants en chaînes
// de chiffres → BigInt, régime déclaré, lignes bornées) et PERSISTE le verdict
// REJECTED avec sa raison. Une validation ici qui lèverait laisserait le
// document en RECEIVED sans trace de ce que le modèle a rendu — exactement
// l'angle mort que le registre existe pour fermer.
//
// ── ÉCHEC = 503, JAMAIS UN RECEIVED SILENCIEUX ───────────────────────────────
// Panne réseau, délai dépassé, statut non-2xx, enveloppe malformée : le
// connecteur lève ServiceUnavailableException. Le document reste RECEIVED, la
// PWA reçoit un 503 explicite, et le rejeu (même imageSha256) repasse par
// l'inférence — c'est le contrat de OcrVisionService.scanner(). Le corps d'une
// réponse d'erreur n'est ni journalisé ni remonté : un modèle qui échoue peut
// renvoyer l'écho de ce qu'il a lu, et cette lecture contient un client et
// des montants (même posture qu'EtaxClient).

/** Nom du modèle tel que déclaré par le point d'inférence. */
type OcrInferenceEnvelope = {
  modelId: string;
  extraction: unknown;
};

/** Budget de la requête. Le scan est SYNCHRONE (ai.module.ts) : la PWA attend
 *  ce verdict sur 3G. 20 s laisse le temps à un modèle de vision de lire une
 *  page A5 sans que l'appelant croie la requête perdue ; un modèle qui aurait
 *  besoin de plus justifierait une file, et ce serait un ADR. */
export const OCR_VISION_REQUEST_TIMEOUT_MS = 20_000;

export type SovereignOcrVisionConfig = {
  endpoint: string;
  token: string;
};

export class SovereignOcrVisionProvider implements OcrVisionProvider {
  private readonly logger = new Logger(SovereignOcrVisionProvider.name);

  constructor(private readonly config: SovereignOcrVisionConfig) {}

  async extraire(image: OcrImageRef): Promise<OcrInference> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OCR_VISION_REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(`${this.config.endpoint}/extractions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${this.config.token}`,
          },
          body: JSON.stringify({ storageKey: image.storageKey, mimeType: image.mimeType }),
          signal: controller.signal,
        });
      } catch (error) {
        // Réseau ou délai dépassé (AbortError) — un seul mot pour le journal,
        // le détail réseau ne contient rien que l'exploitant ne sache déjà.
        const cause = error instanceof Error && error.name === "AbortError" ? "délai dépassé" : "injoignable";
        this.logger.warn(`Hub Vision ${cause} (${OCR_VISION_REQUEST_TIMEOUT_MS} ms) pour la clé ${image.storageKey}`);
        throw new ServiceUnavailableException(`Hub Vision ${cause} — le scan est à rejouer`);
      }

      if (!response.ok) {
        this.logger.warn(`Hub Vision a répondu ${response.status} pour la clé ${image.storageKey}`);
        throw new ServiceUnavailableException(`Hub Vision a répondu ${response.status} — le scan est à rejouer`);
      }

      const enveloppe = await response.json().catch(() => null);
      if (!estEnveloppe(enveloppe)) {
        this.logger.warn(`Hub Vision a rendu une enveloppe sans modelId pour la clé ${image.storageKey}`);
        throw new ServiceUnavailableException("Hub Vision a rendu une réponse sans identifiant de modèle — le scan est à rejouer");
      }
      return { modelId: enveloppe.modelId, sortie: enveloppe.extraction };
    } finally {
      clearTimeout(timer);
    }
  }
}

function estEnveloppe(valeur: unknown): valeur is OcrInferenceEnvelope {
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
// OCR_VISION_ENDPOINT absent → implémentation NON CONFIGURÉE (503 explicite),
// exactement le comportement livré par la PR #22 : un environnement sans modèle
// ne change pas de contrat, il le dit. Endpoint présent sans jeton → refus au
// DÉMARRAGE, pas au premier scan : une configuration à moitié faite se voit
// dans les journaux de déploiement, pas dans le 503 d'un commerçant à Madina.
//
// Même patron que certification.module.ts (useFactory + process.env) —
// trust-api n'embarque pas @nestjs/config, et en ajouter une dépendance pour
// lire deux variables serait la mauvaise échelle.
export function ocrVisionProviderFromEnv(env: NodeJS.ProcessEnv = process.env): OcrVisionProvider {
  const endpoint = env.OCR_VISION_ENDPOINT?.trim();
  if (!endpoint) {
    return new UnconfiguredOcrVisionProvider();
  }
  const token = env.OCR_VISION_TOKEN?.trim();
  if (!token) {
    throw new Error("OCR_VISION_ENDPOINT est défini mais OCR_VISION_TOKEN est vide — le Hub Vision refuse de démarrer à moitié configuré (ADR-122)");
  }
  // Sans barre finale : le connecteur suffixe `/extractions`.
  return new SovereignOcrVisionProvider({ endpoint: endpoint.replace(/\/+$/, ""), token });
}
