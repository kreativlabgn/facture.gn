import { z } from "zod";

// F11, ADR-077 — APIP transmet RCCM+NIF à la création d'entreprise, jamais
// optionnels contrairement au self-service (ADR-035, B4). regimeFiscal/
// legalForm exigés explicitement : aucun défaut serveur arbitraire pour un
// champ fiscal — à ajuster si le payload réel d'APIP diverge à l'intégration.
export const createFromApipSchema = z.object({
  name: z.string().min(1),
  regimeFiscal: z.enum(["normal_tva", "tpu", "normal_sans_tva", "non_assujetti_association"]),
  legalForm: z.enum(["commercial", "association"]),
  nif: z.string().min(1),
  rccm: z.string().min(1),
});

export type CreateFromApipDto = z.infer<typeof createFromApipSchema>;
