import { z } from "zod";

// Corps POST /webhooks/whatsapp (Meta Cloud API, clarification 6 du plan
// 2026-09-16). TOLÉRANT (pas .strict()) : Meta ajoute des champs (statuts de
// lecture, réactions, contacts...) qu'on ignore délibérément — z.object()
// élague silencieusement les clés inconnues au lieu de faire échouer tout le
// webhook dessus. Types de message NON gérés (image, vidéo, document,
// sticker, localisation, contact) : jamais rejetés ici, traités comme "type
// non supporté" côté whatsapp-inbound.service.ts (réponse pédagogique, jamais
// un crash).

const whatsappTextSchema = z.object({
  body: z.string(),
});

const whatsappAudioSchema = z.object({
  id: z.string(),
  mime_type: z.string(),
});

export const whatsappMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string().optional(),
  type: z.string(),
  text: whatsappTextSchema.optional(),
  audio: whatsappAudioSchema.optional(),
});

export const whatsappWebhookSchema = z.object({
  object: z.string(),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string(),
          value: z.object({
            messages: z.array(whatsappMessageSchema).optional(),
            // Accusés de lecture/livraison — jamais exploités par ce guichet,
            // ignorés plutôt que rejetés (Meta les envoie sur le MÊME webhook).
            statuses: z.array(z.unknown()).optional(),
          }),
        }),
      ),
    }),
  ),
});

export type WhatsAppWebhookDto = z.infer<typeof whatsappWebhookSchema>;
export type WhatsAppInboundMessage = z.infer<typeof whatsappMessageSchema>;
