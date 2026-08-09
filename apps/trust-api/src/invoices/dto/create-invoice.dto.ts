import { z } from "zod";

// taxRateBps n'est plus un champ client (C4) — le taux de TVA est dérivé
// exclusivement de organization.regimeFiscal côté serveur (resolveTaxRateBps),
// jamais une valeur de confiance externe (ADR-033).
const invoiceLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.coerce.bigint().positive(),
});

export const createInvoiceSchema = z
  .object({
    organizationId: z.string().uuid(),
    documentType: z.enum(["invoice", "proforma", "quote"]).default("invoice"),
    // C6 — client à crédit récurrent, optionnel ("nullable pour anonyme", ERD).
    // Validé côté service (appartient à la même organizationId), jamais fait
    // confiance au client sur ce point.
    customerId: z.string().uuid().optional(),
    lines: z.array(invoiceLineSchema).min(1),
    // Remise globale en pourcentage (E2) — défaut 0, cohérent avec le défaut DB
    // (Invoice.discountPct @default(0)), jamais un défaut serveur différent.
    discountPct: z.number().int().min(0).max(100).default(0),
    // Montant de référence en devise étrangère (I3, ADR-055) — "aucune valeur
    // contractuelle", purement informatif, jamais dans le payload signé. Les 4
    // champs forment un seul instantané de change cohérent (refine ci-dessous).
    // fxRate en string (jamais un number JS) — évite toute perte de précision
    // flottante sur un taux de change, transmis tel quel au champ Decimal Prisma.
    referenceCurrency: z.string().regex(/^[A-Z]{3}$/, "Code devise ISO 4217 attendu (ex. USD)").optional(),
    referenceAmount: z.coerce.bigint().positive().optional(),
    fxRate: z.string().regex(/^\d+(\.\d+)?$/, "Taux de change attendu au format décimal (ex. 9440.50)").optional(),
    fxRateDate: z.coerce.date().optional(),
  })
  .refine(
    (data) =>
      [data.referenceCurrency, data.referenceAmount, data.fxRate, data.fxRateDate].every((v) => v === undefined) ||
      [data.referenceCurrency, data.referenceAmount, data.fxRate, data.fxRateDate].every((v) => v !== undefined),
    {
      message: "referenceCurrency, referenceAmount, fxRate et fxRateDate sont exigés ensemble (ADR-055) — les 4 ou aucun",
      path: ["referenceCurrency"],
    },
  );

export type CreateInvoiceDto = z.infer<typeof createInvoiceSchema>;
