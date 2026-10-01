import { Logger } from "@nestjs/common";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { WHATSAPP_GRAPH_API_BASE_URL } from "./whatsapp.constants";

// Plan 2026-09-16 (OCR multicanal), étape 3 — relais du média vocal WhatsApp.
// trust-api n'a jamais eu de client de stockage objet avant ce fichier (voir
// le plan, §clarification 6 "Média vocal WhatsApp") : la PWA/Web dépose ses
// propres fichiers directement dans le stockage, trust-api ne connaît qu'une
// storageKey. Ici, c'est l'inverse — les octets vivent CHEZ META, le seul
// moyen de les obtenir est un appel serveur-à-serveur authentifié par
// WHATSAPP_ACCESS_TOKEN. Ce service télécharge donc depuis l'API Graph Meta et
// DÉPOSE dans le MÊME stockage objet souverain que les photos (MinIO
// auto-hébergé, DAT/ADR-013 — tranché par le fondateur), sous une storageKey
// FRAÎCHE, avant que quoi que ce soit d'autre (SttProvider) ne lise cette
// référence. Jamais les octets ailleurs qu'entre Meta → ce service → MinIO.
//
// ── SÉQUENCE, EXACTEMENT ─────────────────────────────────────────────────────
// 1. GET {WHATSAPP_GRAPH_API_BASE_URL}/{media-id}, Authorization: Bearer
//    {WHATSAPP_ACCESS_TOKEN} → { url, mime_type } (métadonnées, pas les
//    octets : l'API Graph rend une URL de téléchargement à courte durée de
//    vie).
// 2. GET {url}, MÊME en-tête d'autorisation → octets.
// 3. PutObject dans STORAGE_BUCKET (MinIO), clé whatsapp/{organizationId}/
//    {whatsappMessageId} — fraîche à chaque message (whatsappMessageId est
//    @unique global sur ocr_document, voir whatsapp-inbound.service.ts : deux
//    appels de ce service pour le même message ne peuvent survenir que sur une
//    redélivraison Meta déjà interceptée en amont par la déduplication wamid).
//
// ── POINT D'ATTENTION MINIO CONNU ────────────────────────────────────────────
// forcePathStyle: true + région factice ("us-east-1") — MinIO ne sert pas le
// virtual-hosted-style par défaut (bucket.host/key) ; sans ces deux réglages
// le SDK échoue contre MinIO même avec des identifiants valides.
//
// ── GESTION D'ÉCHEC : UNE SEULE EXCEPTION TYPÉE, JAMAIS UN CRASH NON ATTRAPÉ ─
// Ce service est appelé DEPUIS whatsapp-inbound.service.ts, dans le flux du
// webhook POST /webhooks/whatsapp, qui répond TOUJOURS 200 à Meta séparément
// (le corps HTTP est un accusé technique, jamais le message vu par
// l'utilisateur — voir whatsapp-inbound.controller.ts). Une exception non
// rattrapée ici ferait échouer la requête webhook elle-même (500), et Meta
// relivrerait le message en boucle — c'est l'inverse de la garantie "jamais un
// silence" du plan.
//
// Choix : UNE SEULE classe d'erreur, WhatsAppMediaRelayIndisponible, levée
// pour TOUS les cas d'échec (jeton invalide, média introuvable, API Graph
// injoignable, MinIO injoignable, configuration absente). Un retour discriminé
// (`{ok: false, reason: ...}`) aurait été l'autre option, mais ce dépôt
// utilise déjà systématiquement des exceptions typées pour ce genre de contrat
// (EtaxRejetDefinitif dans etax.client.ts, ServiceUnavailableException dans
// sovereign-ocr-vision.provider.ts/sovereign-stt.provider.ts) — rester
// cohérent avec l'existant plutôt qu'introduire un second style pour un seul
// fichier. Une SEULE classe (pas une par cause) parce que l'appelant n'a
// besoin que d'UNE décision — "le relais a-t-il échoué, oui ou non" — jamais
// de brancher un comportement différent par cause précise ; le détail (jeton
// invalide vs MinIO injoignable) reste dans le message et les logs pour le
// diagnostic, jamais dans le type de l'exception. whatsapp-inbound.service.ts
// attrape SPÉCIFIQUEMENT WhatsAppMediaRelayIndisponible (instanceof) et répond
// par le message WhatsApp dédié ; toute AUTRE exception (bug réel, pas une
// panne réseau prévisible) continue de remonter et de faire échouer la
// requête webhook — fail loud, même doctrine que "état à faire remonter fort,
// jamais à masquer" (ocr-vision.service.ts).
export class WhatsAppMediaRelayIndisponible extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppMediaRelayIndisponible";
  }
}

/** Budget de CE relais — synchrone dans le flux webhook (whatsapp-inbound.service.ts
 *  attend son résultat avant de répondre 200 à Meta), même raisonnement que
 *  OCR_VISION_REQUEST_TIMEOUT_MS : appliqué séparément aux deux appels sortants
 *  vers l'API Graph (métadonnées, puis octets). */
export const WHATSAPP_MEDIA_RELAY_REQUEST_TIMEOUT_MS = 20_000;

export type WhatsAppMediaRelayInput = {
  organizationId: string;
  /** wamid Meta du message audio — sert à construire la storageKey. */
  whatsappMessageId: string;
  /** Identifiant de média Meta (message.audio.id du webhook). */
  mediaId: string;
};

export type WhatsAppMediaRelayResult = {
  storageKey: string;
  /** Type MIME rendu par les MÉTADONNÉES Meta (informatif) — l'appelant reste
   *  libre d'utiliser celui déjà déclaré par le webhook (message.audio.mime_type)
   *  pour la suite du pipeline, les deux sources devant coïncider en pratique. */
  mimeType: string;
};

export interface WhatsAppMediaRelay {
  relayer(input: WhatsAppMediaRelayInput): Promise<WhatsAppMediaRelayResult>;
}

// Implémentation par défaut tant que le stockage objet et/ou le jeton Meta ne
// sont pas configurés (STORAGE_*/WHATSAPP_ACCESS_TOKEN). CONTRAIREMENT au Hub
// Vision/STT (OCR_VISION_ENDPOINT/OCR_STT_ENDPOINT définis sans jeton → refus
// AU DÉMARRAGE de tout trust-api), une configuration STORAGE_* absente NE FAIT
// JAMAIS échouer le démarrage ici : Vision/STT sont sur le chemin PWA
// SYNCHRONE déjà existant (scan photo), une configuration à moitié faite y
// est un incident immédiat et visible. Le relais média WhatsApp n'est
// qu'UNE branche d'une surface encore plus récente (WHATSAPP_VOICE) — la
// faire échouer prédictiblement (503 métier via WhatsAppMediaRelayIndisponible,
// message WhatsApp dédié) est largement suffisant, et bien moins risqué que de
// conditionner le démarrage de trust-api entier (facturation, certification,
// USSD...) à la présence d'un bucket MinIO dont seule la voix WhatsApp dépend.
export class UnconfiguredWhatsAppMediaRelay implements WhatsAppMediaRelay {
  relayer(_input: WhatsAppMediaRelayInput): Promise<WhatsAppMediaRelayResult> {
    return Promise.reject(
      new WhatsAppMediaRelayIndisponible(
        "Relais média WhatsApp non configuré (STORAGE_ENDPOINT/STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY/STORAGE_BUCKET/WHATSAPP_ACCESS_TOKEN) — la branche vocale du guichet WhatsApp est indisponible sur cet environnement",
      ),
    );
  }
}

/** Surface minimale typée localement plutôt que le type `S3Client` complet du
 *  SDK — même précédent que QueueWithClient (whatsapp-abuse-guard.service.ts) :
 *  les tests injectent un client factice qui n'implémente que `send()`, sans
 *  reproduire toute la machinerie de signature du SDK AWS. */
export type S3LikeClient = {
  send(command: PutObjectCommand): Promise<unknown>;
};

export type SovereignWhatsAppMediaRelayConfig = {
  accessToken: string;
  bucket: string;
  s3: S3LikeClient;
};

type MetaMediaMetadata = {
  url: string;
  mime_type: string;
};

export class SovereignWhatsAppMediaRelayService implements WhatsAppMediaRelay {
  private readonly logger = new Logger(SovereignWhatsAppMediaRelayService.name);

  constructor(private readonly config: SovereignWhatsAppMediaRelayConfig) {}

  async relayer(input: WhatsAppMediaRelayInput): Promise<WhatsAppMediaRelayResult> {
    const metadata = await this.recupererMetadonnees(input.mediaId);
    const octets = await this.telechargerOctets(metadata.url);
    const storageKey = `whatsapp/${input.organizationId}/${input.whatsappMessageId}`;
    await this.deposer(storageKey, octets, metadata.mime_type);
    // Longueur seulement — jamais les octets ni un extrait du contenu.
    this.logger.log(`Média WhatsApp ${input.whatsappMessageId} relayé vers ${storageKey} (${octets.length} octets)`);
    return { storageKey, mimeType: metadata.mime_type };
  }

  // ── Étape 1 : métadonnées (url à courte durée de vie + type MIME) ──────────
  private async recupererMetadonnees(mediaId: string): Promise<MetaMediaMetadata> {
    const response = await this.fetchAvecDelai(
      `${WHATSAPP_GRAPH_API_BASE_URL}/${mediaId}`,
      { headers: { Authorization: `Bearer ${this.config.accessToken}` } },
      "métadonnées du média",
    );

    if (response.status === 401 || response.status === 403) {
      this.logger.warn(`API Graph Meta a refusé le jeton pour le média ${mediaId} (${response.status})`);
      throw new WhatsAppMediaRelayIndisponible("Jeton WhatsApp invalide ou expiré — relais média refusé par Meta");
    }
    if (response.status === 404) {
      this.logger.warn(`Média WhatsApp ${mediaId} introuvable chez Meta (404)`);
      throw new WhatsAppMediaRelayIndisponible("Média WhatsApp introuvable — peut-être déjà expiré côté Meta");
    }
    if (!response.ok) {
      this.logger.warn(`API Graph Meta a répondu ${response.status} pour les métadonnées du média ${mediaId}`);
      throw new WhatsAppMediaRelayIndisponible(`API Graph Meta a répondu ${response.status} — métadonnées du média`);
    }

    // Le corps d'une réponse Meta n'est PAS journalisé au-delà de sa forme
    // (même posture que sovereign-ocr-vision.provider.ts) : une erreur peut en
    // écho contenir des détails de compte plateforme.
    const corps: unknown = await response.json().catch(() => null);
    if (!estMetadata(corps)) {
      this.logger.warn(`API Graph Meta a rendu des métadonnées incomplètes pour le média ${mediaId}`);
      throw new WhatsAppMediaRelayIndisponible("API Graph Meta a rendu une réponse sans url/mime_type exploitable");
    }
    return corps;
  }

  // ── Étape 2 : octets, MÊME en-tête d'autorisation ───────────────────────────
  private async telechargerOctets(url: string): Promise<Buffer> {
    const response = await this.fetchAvecDelai(
      url,
      { headers: { Authorization: `Bearer ${this.config.accessToken}` } },
      "téléchargement du média",
    );
    if (!response.ok) {
      this.logger.warn(`API Graph Meta a répondu ${response.status} au téléchargement du média`);
      throw new WhatsAppMediaRelayIndisponible(`API Graph Meta a répondu ${response.status} — téléchargement du média`);
    }
    const tampon = await response.arrayBuffer();
    return Buffer.from(tampon);
  }

  // ── Étape 3 : dépôt MinIO, clé fraîche ──────────────────────────────────────
  private async deposer(storageKey: string, octets: Buffer, mimeType: string): Promise<void> {
    try {
      await this.config.s3.send(
        new PutObjectCommand({ Bucket: this.config.bucket, Key: storageKey, Body: octets, ContentType: mimeType }),
      );
    } catch (error) {
      // Le nom de l'erreur SDK suffit au diagnostic — jamais les octets qui
      // viennent d'être téléchargés, jamais un message d'erreur susceptible de
      // recopier des identifiants.
      this.logger.warn(
        `Dépôt MinIO impossible pour la clé ${storageKey} — ${error instanceof Error ? error.name : "erreur inconnue"}`,
      );
      throw new WhatsAppMediaRelayIndisponible("Stockage objet injoignable — dépôt du média WhatsApp impossible");
    }
  }

  private async fetchAvecDelai(url: string, init: RequestInit, etape: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHATSAPP_MEDIA_RELAY_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      const cause = error instanceof Error && error.name === "AbortError" ? "délai dépassé" : "injoignable";
      this.logger.warn(`API Graph Meta ${cause} (${WHATSAPP_MEDIA_RELAY_REQUEST_TIMEOUT_MS} ms) — ${etape}`);
      throw new WhatsAppMediaRelayIndisponible(`API Graph Meta ${cause} — ${etape}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function estMetadata(valeur: unknown): valeur is MetaMediaMetadata {
  return (
    typeof valeur === "object" &&
    valeur !== null &&
    typeof (valeur as MetaMediaMetadata).url === "string" &&
    (valeur as MetaMediaMetadata).url.length > 0 &&
    typeof (valeur as MetaMediaMetadata).mime_type === "string" &&
    (valeur as MetaMediaMetadata).mime_type.length > 0
  );
}

// ── Jeton d'injection Nest ────────────────────────────────────────────────────
export const WHATSAPP_MEDIA_RELAY = Symbol("WHATSAPP_MEDIA_RELAY");

// ── Fabrique par environnement ────────────────────────────────────────────────
//
// Même discipline d'usine que ocrVisionProviderFromEnv()/sttProviderFromEnv() —
// mais SANS le refus au démarrage sur configuration à moitié faite (voir le
// commentaire d'UnconfiguredWhatsAppMediaRelay ci-dessus) : ici, TOUTE pièce
// manquante (n'importe laquelle des cinq variables) retombe sur
// l'implémentation non configurée, jamais une exception synchrone au
// bootstrap.
export function whatsAppMediaRelayFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppMediaRelay {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const endpoint = env.STORAGE_ENDPOINT?.trim();
  const accessKeyId = env.STORAGE_ACCESS_KEY?.trim();
  const secretAccessKey = env.STORAGE_SECRET_KEY?.trim();
  const bucket = env.STORAGE_BUCKET?.trim();

  if (!accessToken || !endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return new UnconfiguredWhatsAppMediaRelay();
  }

  const s3 = new S3Client({
    endpoint,
    // MinIO n'a pas de notion de région — valeur factice exigée par le SDK,
    // jamais interprétée par MinIO lui-même (voir commentaire d'en-tête).
    region: "us-east-1",
    // MinIO ne sert pas le virtual-hosted-style (bucket.host/key) par défaut —
    // sans ce réglage le SDK échoue même avec des identifiants valides.
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });

  return new SovereignWhatsAppMediaRelayService({ accessToken, bucket, s3 });
}
