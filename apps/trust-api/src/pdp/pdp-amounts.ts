// Conversion des montants entrants de la passerelle PDP (ADR-107) en centimes
// GNF (ADR-014, entiers BigInt).
//
// POURQUOI DES CHAÎNES, ET PAS DES NOMBRES. Un ERP tiers sérialise ses montants
// en JSON ; s'ils arrivent en `number`, JSON.parse les a déjà passés par un
// flottant IEEE-754 avant que la moindre ligne de notre code ne s'exécute. À ce
// stade la dérive est faite et rien ne peut la défaire : 8_413_213.14 se relit
// 8413213.139999999. Exiger une CHAÎNE est la seule façon de recevoir le montant
// que l'ERP a réellement calculé, chiffre pour chiffre.
//
// Et la conversion elle-même ne passe par aucun flottant : ni Number(),
// ni parseFloat(), ni Math.round(). La partie entière et les décimales sont
// séparées TEXTUELLEMENT puis recomposées en BigInt.
//
// Littéraux BigInt (`0n`, `100n`) proscrits : la cible de compilation du web est
// ES2017 (voir apps/web), et bien que trust-api compile en ES2022, la même
// discipline s'applique de bout en bout pour qu'un helper puisse migrer d'un
// paquet à l'autre sans se transformer en erreur de syntaxe. BigInt(100) partout.
const CENTIMES_PAR_UNITE = BigInt(100);

const DECIMALES_MAX = 2;

/** Jusqu'à 15 chiffres avant la virgule (≈ 10^15 GNF, soit très au-delà de tout
 *  chiffre d'affaires réel) et au plus 2 décimales. Ni signe, ni espace, ni
 *  séparateur de milliers, ni notation exponentielle : un montant fiscal se
 *  transmet en clair. La borne haute n'est pas décorative — elle empêche un
 *  connecteur fautif d'insérer un BigInt de plusieurs kilo-octets en base. */
export const PDP_MONTANT_PATTERN = /^\d{1,15}(?:\.\d{1,2})?$/;

/**
 * « 150000 » → 15000000 centimes. « 8413213.14 » → 841321314 centimes.
 *
 * Lève une `RangeError` sur toute chaîne hors format — appelée depuis le schéma
 * Zod, qui la convertit en 400 lisible pour le connecteur.
 */
export function toCentimes(montant: string): bigint {
  if (!PDP_MONTANT_PATTERN.test(montant)) {
    throw new RangeError(
      `Montant « ${montant} » invalide — attendu une chaîne numérique positive, au plus ${DECIMALES_MAX} décimales (ex. « 150000 » ou « 8413213.14 »)`,
    );
  }

  const [entier, decimales = ""] = montant.split(".");

  // padEnd et non un multiplicateur variable : « 1.5 » vaut 1,50 GNF, donc 150
  // centimes — jamais 15. C'est l'erreur classique de ce type de conversion.
  return BigInt(entier) * CENTIMES_PAR_UNITE + BigInt(decimales.padEnd(DECIMALES_MAX, "0"));
}
