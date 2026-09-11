import { z } from "zod";
import type { SaisieRegime } from "@facture-gn/db";

// Contrat de sortie du modèle de vision (ADR-122) — ce que le Hub renvoie après
// avoir lu une facture papier, et la SEULE forme que le serveur accepte de lui.
//
// ── POURQUOI DES CHAÎNES DE CHIFFRES, ET PAS DES NOMBRES ────────────────────
// Le modèle sérialise sa lecture en JSON. Un montant rendu en `number` passe
// par un flottant IEEE-754 dans JSON.parse AVANT que la moindre ligne de notre
// code ne s'exécute : au-delà de 2^53 centimes la précision s'effondre, et en
// deçà une décimale mal placée (« 1500.5 ») devient 1500.4999… Exiger une
// chaîne de CHIFFRES SEULS est ce qui rend la lecture du modèle transportable
// chiffre pour chiffre jusqu'au BigInt — même discipline que pdp-amounts.ts,
// en plus strict encore : ici pas de point décimal du tout, le modèle est
// instruit d'émettre directement des CENTIMES entiers (ADR-014).
//
// La conversion est BigInt(chaîne) — aucun Number(), parseFloat() ni
// Math.round() ne s'interpose. Littéraux BigInt (`0n`) proscrits : le web
// cible ES2017 (voir apps/web), et un helper doit pouvoir migrer d'un paquet
// à l'autre sans se transformer en erreur de syntaxe.

/** Chiffres seuls, au plus 17 (≈ 10^15 GNF : très au-delà de tout chiffre
 *  d'affaires réel). La borne haute n'est pas décorative — elle empêche un
 *  modèle qui hallucine de faire insérer un BigInt de plusieurs kilo-octets en
 *  base. */
export const OCR_CENTIMES_PATTERN = /^\d+$/;
const OCR_CENTIMES_CHIFFRES_MAX = 17;

const centimes = z
  .string()
  .regex(
    OCR_CENTIMES_PATTERN,
    "Montant attendu en centimes GNF, chaîne de chiffres seuls (ex. « 150000 » pour 1 500,00 GNF)",
  )
  .max(OCR_CENTIMES_CHIFFRES_MAX, `Montant hors borne — au plus ${OCR_CENTIMES_CHIFFRES_MAX} chiffres`)
  .transform((valeur) => BigInt(valeur));

// ADR-108 — le modèle DÉCLARE le régime qu'il a reconnu sur le papier : prix
// unitaires hors taxes (carnet « pro », TVA en pied) ou toutes taxes comprises
// (carnet de détail, où le prix affiché est celui que le client paie). Ce
// drapeau décide de la colonne contre laquelle OcrValidationService resomme les
// lignes ; il n'est jamais deviné côté serveur.
export const OCR_SAISIE_REGIMES = ["HT_FIRST", "TTC_FIRST"] as const satisfies readonly SaisieRegime[];

const ocrLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity: z.number().int().positive(),
  // Dans l'unité du régime déclaré (HT ou TTC), en centimes.
  unitPrice: centimes,
  // Le total de ligne TEL QU'ÉCRIT sur le papier — pas recalculé par le modèle.
  // C'est l'égalité quantity × unitPrice = lineTotal que le serveur vérifie
  // (première garde). Un modèle qui « corrigerait » ce total masquerait
  // précisément l'erreur de calcul du carnet que la relecture doit voir.
  lineTotal: centimes,
});

export const ocrExtractionSchema = z.object({
  // Numéro écrit sur la souche, s'il y en a un. Déclaratif — la numérotation
  // Article 23 du brouillon reste celle de facture.gn, jamais celle du carnet.
  documentNumber: z.string().max(64).optional(),
  // Date lue sur le papier, ISO 8601 (AAAA-MM-JJ). Déclarative, même remarque.
  issueDate: z.coerce.date().optional(),

  // Le client tel que lu : des libellés, jamais un uuid de notre base (le
  // modèle n'en a pas). Optionnel — une vente au comptant est anonyme,
  // exactement comme Invoice.customerId est nullable.
  customer: z
    .object({
      name: z.string().min(1).max(255),
      nif: z.string().max(64).optional(),
    })
    .optional(),

  saisieRegime: z.enum(OCR_SAISIE_REGIMES),

  lines: z.array(ocrLineSchema).min(1).max(200),

  // Les trois totaux LUS en pied de facture. Les trois, pas deux : contrairement
  // à la passerelle PDP, où le TTC est dérivé côté serveur, ici le TTC écrit sur
  // le papier est une DONNÉE à confronter — c'est l'un des écarts que la
  // double-garde doit relever, pas une valeur à reconstruire.
  totals: z.object({
    totalHT: centimes,
    totalVAT: centimes,
    totalTTC: centimes,
  }),

  // Confiance globale auto-déclarée par le modèle, [0, 1]. Informative
  // seulement : elle ne participe à AUCUNE décision serveur — la seule chose
  // qui décide de l'insertion automatique est l'arithmétique au centime près.
  confidence: z.number().min(0).max(1).optional(),
});
// Aucun organizationId ici, et ce n'est pas un oubli : l'organisation vient du
// RolesGuard (@CurrentOrganizationId), jamais d'un champ que le modèle — ou
// quiconque rejoue sa sortie — contrôlerait. z.object() élague les clés
// inconnues : un organizationId glissé dans la sortie n'atteint jamais le
// service (vérifié par le spec).

export type OcrExtraction = z.infer<typeof ocrExtractionSchema>;
export type OcrExtractionLine = OcrExtraction["lines"][number];
export type OcrSaisieRegime = (typeof OCR_SAISIE_REGIMES)[number];
