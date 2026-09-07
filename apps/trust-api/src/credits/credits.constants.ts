// Tarifs du portefeuille de crédits, en centimes GNF (100 centimes = 1 GNF).
//
// Grille hardcodée, même pattern que commission-grid.ts et
// plan-features-grid.ts : ADR-058 demande une table de configuration versionnée
// pour ce type de donnée, jamais scaffoldée dans ce dépôt. Un seul endroit à
// toucher, et un test qui vérifie la cohérence du pack.

/** Un SMS de relance. Dérivé du pack commercial : 100 SMS pour 30 000 GNF. */
export const TARIF_SMS_CENTIMES = 30_000n;

/** Un message WhatsApp.
 *
 *  VALEUR DÉCIDÉE, PAS RELEVÉE — aucun prix n'a été communiqué pour ce canal.
 *  Posée à la moitié du SMS : la messagerie applicative revient structurellement
 *  moins cher que le réseau GSM, et facturer les deux au même prix pousserait le
 *  commerçant vers le canal le plus coûteux pour la plateforme. À confirmer
 *  contre le tarif réel du fournisseur. */
export const TARIF_WHATSAPP_CENTIMES = 15_000n;

/** Le pack vendu : 100 SMS pour 30 000 GNF. */
export const PACK_SMS_QUANTITE = 100;
export const PACK_SMS_CENTIMES = 3_000_000n;

// LA TÉLÉTRANSMISSION eTAX N'EST PAS FACTURÉE, et c'est délibéré : déclarer sa
// TVA est une obligation légale, pas un service optionnel. Faire payer un
// commerçant pour se mettre en conformité placerait la plateforme entre lui et
// l'administration — et un solde vide bloquerait une déclaration due. Le worker
// eTax ne consulte donc jamais le portefeuille.

/** Ce que coûte un envoi, par canal. Le libellé du relevé est construit par
 *  l'appelant, qui seul connaît le contexte (numéro de facture, client). */
export const TARIF_PAR_CANAL = {
  sms: TARIF_SMS_CENTIMES,
  whatsapp: TARIF_WHATSAPP_CENTIMES,
} as const;

export type CanalFacturable = keyof typeof TARIF_PAR_CANAL;

// Un client en `both` reçoit DEUX messages : il doit donc être débité deux
// fois. Cette fonction est le pendant facturier de
// resolveNotificationProviders() — même découpage du canal, appliqué au
// portefeuille plutôt qu'aux fournisseurs. Les deux doivent rester d'accord :
// un canal qui enverrait sans débiter serait un envoi offert, l'inverse un
// débit sans envoi.
export function canauxFactures(channel: "sms" | "whatsapp" | "both"): CanalFacturable[] {
  if (channel === "both") {
    return ["sms", "whatsapp"];
  }
  return [channel];
}
