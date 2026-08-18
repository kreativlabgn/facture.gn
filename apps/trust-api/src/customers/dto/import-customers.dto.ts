import { z } from "zod";
import { msisdnSchema } from "../../auth/dto/register.dto";
import { MAX_IMPORT_BATCH_SIZE } from "../import-customers.constants";

// E9, ADR-100 — mêmes champs que createCustomerSchema, moins organizationId
// (porté par le lot entier, pas par ligne). Appliqué ligne par ligne DANS LE
// SERVICE (safeParse), jamais par la ZodValidationPipe globale : une ligne
// invalide ne doit jamais faire échouer les 299 autres (voir PLAN.md,
// "Alternatives écartées" — déviation assumée de la convention ZodValidationPipe
// stricte utilisée par tous les autres DTO de ce repo).
export const importCustomerRowSchema = z.object({
  name: z.string().min(1),
  phone: msisdnSchema.optional(),
  nif: z.string().min(1).optional(),
  creditLimit: z.coerce.bigint().nonnegative().optional(),
  notificationChannel: z.enum(["sms", "whatsapp", "both"]).optional(),
});

export type ImportCustomerRowDto = z.infer<typeof importCustomerRowSchema>;

// customers: z.unknown() volontairement — la FORME du lot (tableau, taille) est
// validée ici ; le CONTENU de chaque ligne est validé par importCustomerRowSchema
// dans CustomersService.importCustomers(), jamais ici.
export const importCustomersSchema = z.object({
  organizationId: z.string().uuid(),
  customers: z.array(z.unknown()).min(1).max(MAX_IMPORT_BATCH_SIZE),
});

export type ImportCustomersDto = z.infer<typeof importCustomersSchema>;
