import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

// Contrat webhook stub (voir plan ussd-session-infra) — input = SEULE la
// dernière saisie de l'utilisateur, jamais l'historique cumulé façon
// Africa's Talking (aucun agrégateur choisi à ce stade).
export const ussdRequestSchema = z.object({
  sessionId: z.string().min(1),
  phone: msisdnSchema,
  input: z.string(),
});

export type UssdRequestDto = z.infer<typeof ussdRequestSchema>;
