import { z } from "zod";

// POST /organizations/:id/whatsapp-ocr-channel (plan 2026-09-16, OCR
// multicanal, clarification 7) — transition NOMMÉE, même patron que
// /commercial-tier : jamais un champ noyé dans PATCH /organizations/:id
// (update-organization.dto.ts, réservé à l'identité légale).
export const setWhatsappOcrChannelSchema = z.object({
  enabled: z.boolean(),
});

export type SetWhatsappOcrChannelDto = z.infer<typeof setWhatsappOcrChannelSchema>;
