import { z } from "zod";

// taxRateBps n'est plus un champ client (C4) — le taux de TVA est dérivé
// exclusivement de organization.regimeFiscal côté serveur (resolveTaxRateBps),
// jamais une valeur de confiance externe (ADR-033).
// Exporté (I1) pour être réutilisé tel quel par
// recurring-templates/dto/create-recurring-template.dto.ts — jamais une copie
// séparée qui pourrait diverger (ex. un futur champ ajouté ici sans l'ajouter
// là-bas).
export const invoiceLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.coerce.bigint().positive(),
  // E7, ADR-084 — optionnel : rétrocompatibilité totale avec la vente libre
  // (cas majoritaire actuel). Une ligne sans productId n'a simplement pas de
  // marge calculable, jamais une erreur.
  productId: z.string().uuid().optional(),
  // Lot C, ADR-109 — EN 16931 BT-157 (identifiant standard de l'article :
  // réf. catalogue acheteur, code CPV…). Déclaratif, jamais vérifié. Distinct
  // de productId (catalogue interne). Pas de .min(1) — même discipline
  // qu'ADR-090 (une chaîne vide envoyée explicitement est transportée telle
  // quelle, jamais promue en erreur).
  productCode: z.string().optional(),
});

export const createInvoiceSchema = z
  .object({
    organizationId: z.string().uuid(),
    documentType: z.enum(["invoice", "proforma", "quote"]).default("invoice"),
    // C6 — client à crédit récurrent, optionnel ("nullable pour anonyme", ERD).
    // Validé côté service (appartient à la même organizationId), jamais fait
    // confiance au client sur ce point.
    customerId: z.string().uuid().optional(),
    // E1 — succursale, optionnel (une organisation mono-site n'en a jamais).
    // Même discipline de validation que customerId.
    branchId: z.string().uuid().optional(),
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
    // K3, ADR-090 — "Référence marché TELEMO", recopiée à la main par la PME au
    // moment de l'émission, AUCUNE vérification automatique. Optionnel : une
    // facture sans référence suit exactement le même parcours qu'une facture
    // avec référence (Backlog K3).
    // Revue post-fix #1 — pas de .min(1) : une chaîne vide "" envoyée
    // explicitement par un appelant HTTP direct est acceptée telle quelle,
    // sans être promue en erreur de validation ni réinterprétée en
    // undefined ici. La normalisation "champ vide → pas de référence" est
    // déjà faite en amont côté appelant (ex. USSD : voir
    // `input.trim() || undefined` dans ussd-session.service.ts) — cohérent
    // avec "AUCUNE vérification automatique" : ce DTO ne juge pas le
    // contenu du champ, il le transporte tel quel.
    referenceMarche: z.string().optional(),
    // F — "Valable jusqu'au", saisi uniquement pour un devis (documentType
    // "quote"). DÉCLARATIF, jamais vérifié : même discipline que
    // referenceMarche ci-dessus, AUCUN .refine() croisé avec documentType (un
    // devis sans date de validité suit le même parcours qu'un devis avec
    // date, et un appelant direct posant ce champ sur une facture n'est pas
    // bloqué ici — la distinction produit reste portée côté web, jamais dans
    // ce DTO).
    // z.coerce.date() : un <input type="date"> HTML envoie "YYYY-MM-DD" sans
    // fuseau horaire, interprété en UTC minuit — comportement accepté tel
    // quel (même risque documenté que fxRateDate ci-dessus), pas une logique
    // de fuseau horaire à inventer ici.
    quoteValidUntil: z.coerce.date().optional(),
    // Lot C, ADR-109 — contexte et références B2G structurées, alignement
    // EN 16931. Tous DÉCLARATIFS, recopiés tels quels, AUCUNE vérification
    // (même discipline qu'ADR-090 : la cohérence est rapprochée humainement
    // par le DAF à la validation de liquidation — jamais de refine bloquant,
    // notamment pas "marche_public exige referenceMarche" qui contredirait
    // ADR-090). numeroBonCommande = BT-13, numeroContrat = BT-12,
    // numeroEngagement = engagement budgétaire Trésor (hors EN 16931 core).
    cadreFacturation: z.enum(["standard", "marche_public"]).default("standard"),
    numeroBonCommande: z.string().optional(),
    numeroContrat: z.string().optional(),
    numeroEngagement: z.string().optional(),
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
