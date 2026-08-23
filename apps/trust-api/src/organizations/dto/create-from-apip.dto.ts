import { z } from "zod";

// F11, ADR-077 — APIP transmet RCCM+NIF à la création d'entreprise, jamais
// optionnels contrairement au self-service (ADR-035, B4). regimeFiscal/
// legalForm exigés explicitement : aucun défaut serveur arbitraire pour un
// champ fiscal — à ajuster si le payload réel d'APIP diverge à l'intégration.
export const createFromApipSchema = z
  .object({
    name: z.string().min(1),
    regimeFiscal: z.enum(["normal_tva", "tpu", "normal_sans_tva", "non_assujetti_association"]),
    legalForm: z.enum(["commercial", "association"]),
    nif: z.string().min(1),
    rccm: z.string().min(1),
  })
  // I4, ADR-057 — même règle que create-organization.dto.ts : l'exonération
  // association n'est jamais atteignable par legalForm=commercial, même pour une
  // organisation auto-créée depuis un webhook APIP signé. Sens inverse
  // volontairement pas contraint, voir justification dans
  // create-organization.dto.ts.
  .refine((data) => data.regimeFiscal !== "non_assujetti_association" || data.legalForm === "association", {
    message:
      "Le régime non_assujetti_association est réservé aux organisations legalForm=association (I4, ADR-057)",
    path: ["regimeFiscal"],
  });

export type CreateFromApipDto = z.infer<typeof createFromApipSchema>;
