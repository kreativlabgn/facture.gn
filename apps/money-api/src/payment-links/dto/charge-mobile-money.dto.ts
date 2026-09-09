import { z } from "zod";

// Chantier 3 — débit Mobile Money poussé sur un numéro guinéen.
//
// LE MSISDN ARRIVE DÉJÀ CANONIQUE (+224XXXXXXXXX) : la normalisation des
// écritures locales (« 622 00 00 00 », « 00224622000000 », « 224-622-000-000 »)
// se fait côté web, au plus près de la saisie, où l'on peut encore corriger le
// payeur. Ce schéma refuse tout le reste — une API qui accepterait dix formats
// laisserait dix écritures du même numéro atteindre le gateway, et l'idempotence
// construite dessus ne tiendrait plus.
//
// 9 chiffres après l'indicatif, commençant par 6 : c'est le plan de numérotation
// mobile guinéen. Les préfixes plus fins (62x, 65x, 66x…) ne sont VOLONTAIREMENT
// pas contraints, et l'opérateur n'est pas déduit du numéro : la portabilité
// existe en Guinée, et un préfixe ne dit plus de façon fiable quel réseau porte
// la ligne. C'est le payeur qui déclare son opérateur, lui seul le sait.
const MSISDN_GUINEE = /^\+224[6]\d{8}$/;

export const chargeMobileMoneySchema = z.object({
  msisdn: z
    .string()
    .regex(MSISDN_GUINEE, "Numéro guinéen attendu au format +224XXXXXXXXX (9 chiffres après +224)"),
  operator: z.enum(["orange_money", "mtn_momo"]),
});

export type ChargeMobileMoneyDto = z.infer<typeof chargeMobileMoneySchema>;
