import { z } from "zod";
import { toCentimes } from "../pdp-amounts";

// Payload d'entrée de la passerelle PDP (ADR-107) — le contrat que voit un ERP
// tiers (Odoo, OwoDesk). Volontairement DISTINCT de createInvoiceSchema
// (invoices/dto), et ce n'est pas une duplication à factoriser :
//
//   • createInvoiceSchema porte un organizationId dans le corps. Ici il ne DOIT
//     pas exister — l'organisation vient de la clé API vérifiée par le garde,
//     jamais d'un champ que l'appelant contrôle. L'accepter rouvrirait
//     exactement l'IDOR que le garde vient de fermer.
//   • les montants y sont des BigInt coercés (front interne, déjà en centimes).
//     Ici ce sont des chaînes décimales en GNF : un ERP tiers ne connaît pas
//     notre unité de compte interne.
//   • les identifiants (client, succursale, produit) y sont des uuid de NOTRE
//     base. Un ERP tiers n'en a aucun : il envoie des libellés.
//
// Les deux schémas décrivent donc deux frontières différentes ; les fusionner
// ferait entrer un champ organizationId de confiance dans le chemin public.

const montantGnf = z
  .string()
  .transform((valeur, ctx) => {
    try {
      return toCentimes(valeur);
    } catch (error) {
      // Le message de toCentimes() porte déjà l'exemple attendu — on le relaie
      // tel quel plutôt que d'en écrire un second qui pourrait diverger.
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      return z.NEVER;
    }
  });

// b2b / b2g → e-invoicing unitaire. b2c → e-reporting agrégé.
// Trois valeurs et non deux : la distinction b2b/b2g est conservée telle que
// l'ERP la déclare, parce qu'elle décide du cadre de facturation côté DGI
// (marché public) et qu'elle serait irrécupérable une fois écrasée en
// « e_invoicing ».
export const PDP_TRANSACTION_TYPES = ["b2b", "b2g", "b2c"] as const;

const pdpLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().int().positive(),
  // Prix unitaire HT, même format que les totaux.
  unitPrice: montantGnf,
});

export const createPdpInvoiceSchema = z
  .object({
    // L'identifiant de la facture DANS l'ERP émetteur. C'est la clé
    // d'idempotence : le connecteur DOIT le fournir, et le rejouer à
    // l'identique s'il rejoue sa requête. .min(1) — contrairement à
    // referenceMarche (ADR-090, chaîne vide transportée telle quelle), une
    // chaîne vide ici n'est pas une donnée déclarative anodine : elle
    // ferait converger TOUS les documents sans référence de l'organisation
    // sur une seule ligne tampon, et le second serait rendu comme un
    // doublon du premier.
    clientUniqueId: z.string().min(1).max(128),
    transactionType: z.enum(PDP_TRANSACTION_TYPES),

    totalHT: montantGnf,
    totalVAT: montantGnf,
    // Pas de totalTTC : il est DÉRIVÉ (HT + TVA) côté serveur. L'accepter
    // ouvrirait la porte à un document dont le total ne serait pas la somme de
    // ses parties, incohérence qu'aucune règle de gestion ne saurait arbitrer.

    // Date d'émission côté ERP. Déclarative — la certification, elle, sera
    // horodatée par facture.gn au moment où elle a réellement lieu.
    issueDate: z.coerce.date(),

    // Le client tel que l'ERP le connaît : des libellés, jamais un uuid de notre
    // base (le connecteur n'en a pas). Optionnel — une vente de caisse est
    // anonyme, exactement comme Invoice.customerId est nullable.
    customer: z
      .object({
        name: z.string().min(1).max(255),
        nif: z.string().max(64).optional(),
        address: z.string().max(500).optional(),
      })
      .optional(),

    lines: z.array(pdpLineSchema).min(1).optional(),

    // Références B2G, DÉCLARATIVES et recopiées telles quelles — même discipline
    // qu'ADR-090 / ADR-109 côté interne : aucune vérification automatique, le
    // rapprochement est humain (DAF, validation de liquidation).
    referenceMarche: z.string().max(255).optional(),
    numeroBonCommande: z.string().max(255).optional(),
    numeroContrat: z.string().max(255).optional(),
    numeroEngagement: z.string().max(255).optional(),
  })
  .refine((data) => data.transactionType === "b2c" || (data.lines?.length ?? 0) > 0, {
    message:
      "lines est obligatoire pour un document b2b/b2g — une facture certifiée sans ligne ne peut pas être émise (OHADA Article 23)",
    path: ["lines"],
  })
  .refine(
    (data) => {
      if (data.lines === undefined) {
        return true;
      }
      // Zod exécute ce refine MÊME quand une ligne a déjà échoué sa propre
      // validation : le parse devient « dirty », il n'est pas interrompu. Sans
      // ce garde, `BigInt(1.5)` lèverait une RangeError NON INTERCEPTÉE — un
      // 500 opaque là où le schéma avait déjà de quoi rendre un 400 précis sur
      // `lines.0.quantity`. Une quantité invalide est donc laissée à l'issue
      // que z.number().int().positive() a produite, et la cohérence des totaux
      // n'est pas évaluée sur un document de toute façon rejeté.
      if (!data.lines.every((ligne) => Number.isSafeInteger(ligne.quantity))) {
        return true;
      }
      const somme = data.lines.reduce(
        (total, ligne) => total + ligne.unitPrice * BigInt(ligne.quantity),
        BigInt(0),
      );
      return somme === data.totalHT;
    },
    {
      // Contrôle de cohérence, pas de recalcul : on n'AJUSTE jamais le total
      // annoncé par l'ERP. Un écart signifie que le connecteur et nous ne
      // parlons pas du même document (remise appliquée d'un côté seulement,
      // arrondi ligne à ligne) — mieux vaut un 400 immédiat qu'une facture
      // certifiée dont le total ne correspond pas à ses lignes. Aucune remise
      // globale n'est acceptée sur ce chemin, précisément pour que cette
      // égalité reste vraie.
      message: "totalHT doit être exactement la somme des lignes (quantity × unitPrice) — aucune remise globale n'est acceptée sur ce chemin",
      path: ["totalHT"],
    },
  );

export type CreatePdpInvoiceDto = z.infer<typeof createPdpInvoiceSchema>;
export type PdpTransactionType = (typeof PDP_TRANSACTION_TYPES)[number];
