import { Logger } from "@nestjs/common";
import { WHATSAPP_GRAPH_API_BASE_URL } from "../whatsapp/whatsapp.constants";
import type { NotificationProvider, NotificationSendResult } from "./notification-provider.interface";
import { WhatsAppStubProvider } from "./whatsapp-stub.provider";

// Connecteur LIVE de l'API Graph Meta D'ENVOI (clarification 8 du plan
// 2026-09-16, OCR multicanal) — distinct du webhook ENTRANT
// (whatsapp/whatsapp-inbound.controller.ts) : ce fichier ne PARLE QU'À l'API
// Graph, jamais l'inverse.
//
// ── POURQUOI CE LOT CÂBLE UN CONNECTEUR RÉEL, PAS SEULEMENT UN STUB ─────────
// WhatsAppStubProvider (existant) journalise et répond { success: true } sans
// rien envoyer. Si le canal WhatsApp entrant s'arrête là côté sortant, TOUTE
// la discipline "jamais de silence définitif" votée par le PM devient un
// mensonge en l'absence de configuration réelle : les messages d'opt-in
// désactivé, de rôle insuffisant, de verdict différencié, etc. seraient
// avalés par un logger.log que personne ne lit.
//
// ── FENÊTRE DE 24H META — À NE JAMAIS PERDRE ────────────────────────────────
// Hors de la fenêtre de 24 h suivant le dernier message ENTRANT d'un
// utilisateur, WhatsApp Business exige un message TEMPLATE pré-approuvé, pas
// du texte libre. Ce connecteur ne sert QU'À répondre à un message entrant
// (whatsapp-inbound.service.ts, fenêtre toujours ouverte au moment de la
// réponse) — jamais une notification WhatsApp proactive hors conversation
// active (hors périmètre, signalé au §Risques du plan).
//
// ── ÉCHEC = { success: false }, JAMAIS UNE EXCEPTION ────────────────────────
// Contrairement aux ports du Hub Vision/STT (ServiceUnavailableException,
// backoff BullMQ), NotificationProvider.send() est un contrat BEST-EFFORT
// (voir notification-provider.interface.ts) : chaque appelant (OcrPipelineService,
// whatsapp-inbound.service.ts) l'enveloppe déjà dans un try/catch et ne doit
// jamais voir un échec d'envoi remonter comme une panne du pipeline lui-même.
// Le corps d'une réponse d'erreur n'est ni journalisé ni remonté — même
// posture que sovereign-ocr-vision.provider.ts : une erreur Meta peut échoïr
// le message d'origine, qui contient potentiellement un nom de client.

type WhatsAppSendEnvelope = {
  messages?: { id: string }[];
};

/** Budget de la requête — ce connecteur répond à un webhook déjà traité de
 *  façon asynchrone (job BullMQ ou guichet best-effort), jamais une requête
 *  HTTP dont un utilisateur attend la réponse : court, mais pas serré au
 *  point de faire échouer un envoi légitime sous 3G dégradée. */
export const WHATSAPP_SEND_REQUEST_TIMEOUT_MS = 10_000;

export type SovereignWhatsAppSendConfig = {
  accessToken: string;
  phoneNumberId: string;
};

export class SovereignWhatsAppSendProvider implements NotificationProvider {
  private readonly logger = new Logger(SovereignWhatsAppSendProvider.name);

  constructor(private readonly config: SovereignWhatsAppSendConfig) {}

  async send(phone: string, message: string): Promise<NotificationSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHATSAPP_SEND_REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(`${WHATSAPP_GRAPH_API_BASE_URL}/${this.config.phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: phone,
            type: "text",
            text: { body: message },
          }),
          signal: controller.signal,
        });
      } catch (error) {
        const cause = error instanceof Error && error.name === "AbortError" ? "délai dépassé" : "injoignable";
        this.logger.warn(`API Graph WhatsApp ${cause} (${WHATSAPP_SEND_REQUEST_TIMEOUT_MS} ms) — envoi à ***${phone.slice(-4)}`);
        return { success: false };
      }

      if (!response.ok) {
        this.logger.warn(`API Graph WhatsApp a répondu ${response.status} — envoi à ***${phone.slice(-4)}`);
        return { success: false };
      }

      const enveloppe: unknown = await response.json().catch(() => null);
      if (!estEnveloppe(enveloppe)) {
        this.logger.warn(`API Graph WhatsApp a rendu une enveloppe sans identifiant de message — envoi à ***${phone.slice(-4)}`);
        return { success: false };
      }

      return { success: true };
    } finally {
      clearTimeout(timer);
    }
  }
}

function estEnveloppe(valeur: unknown): valeur is WhatsAppSendEnvelope {
  return (
    typeof valeur === "object" &&
    valeur !== null &&
    Array.isArray((valeur as WhatsAppSendEnvelope).messages) &&
    typeof (valeur as WhatsAppSendEnvelope).messages?.[0]?.id === "string"
  );
}

// ── Fabrique par environnement ───────────────────────────────────────────────
//
// Même discipline d'usine que ocrVisionProviderFromEnv()/sttProviderFromEnv() :
// les DEUX variables présentes → connecteur live ; l'une ou l'autre absente →
// WhatsAppStubProvider INCHANGÉ (comportement dev/test préservé, clarification
// 8 du plan). Contrairement aux hubs souverains, une configuration À MOITIÉ
// FAITE ne fait PAS échouer le démarrage ici : WHATSAPP_ACCESS_TOKEN seul (ou
// WHATSAPP_PHONE_NUMBER_ID seul) retombe sur le stub plutôt que de refuser de
// démarrer — l'envoi sortant est un best-effort, jamais une frontière de
// confiance qui doit fail-fast comme un secret de garde (WHATSAPP_APP_SECRET,
// WHATSAPP_WEBHOOK_VERIFY_TOKEN, eux, fail-fast — voir whatsapp/).
export function whatsappProviderFromEnv(env: NodeJS.ProcessEnv = process.env): NotificationProvider {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!accessToken || !phoneNumberId) {
    return new WhatsAppStubProvider();
  }
  return new SovereignWhatsAppSendProvider({ accessToken, phoneNumberId });
}
