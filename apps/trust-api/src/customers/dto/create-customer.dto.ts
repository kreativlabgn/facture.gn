import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";

// C6, ADR-039 — creditLimit jamais négatif (0 = aucun crédit accordé, une
// valeur métier valide, distincte de "non renseigné" = undefined).
// C9 — canal d'envoi du lien de paiement à CE client précis. Optionnel :
// défaut serveur "sms" (schema.prisma) si omis, jamais un défaut dupliqué ici.
export const createCustomerSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  phone: msisdnSchema.optional(),
  nif: z.string().min(1).optional(),
  creditLimit: z.coerce.bigint().nonnegative().optional(),
  notificationChannel: z.enum(["sms", "whatsapp", "both"]).optional(),
});

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>;
