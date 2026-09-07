import { randomBytes } from "node:crypto";

// Parrainage entre marchands — grille hardcodée, même pattern que
// commission-grid.ts et credits.constants.ts.

/** Prime du parrain, en centimes GNF : 50 000 GNF. */
export const PRIME_PARRAIN_CENTIMES = 5_000_000n;

/** Prime du filleul, en centimes GNF : 15 000 GNF. */
export const PRIME_FILLEUL_CENTIMES = 1_500_000n;

// LES PRIMES SONT VERSÉES EN CRÉDITS, pas en espèces : facture.gn n'a aucun
// moyen de payer un marchand, et un crédit se dépense immédiatement en relances.
// 50 000 GNF valent environ 166 SMS — de quoi relancer tous ses clients pendant
// des mois.

/** Le déclencheur : le filleul quitte Freemium pour un palier payant. Une seule
 *  fois, jamais à chaque changement de palier. */
export const PALIER_NON_CONVERTI = "freemium";

// Alphabet Base32 RFC4648, identique à account-code.ts : lisible à l'oral, pas
// de 0/1/O/I ambigus. Six caractères plutôt que huit — un code de parrainage se
// dicte au téléphone et se recopie à la main, contrairement au code-compte qui
// sert à l'authentification.
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const LONGUEUR_CODE = 6;

export function genererCodeParrainage(): string {
  // randomBytes et jamais Math.random : ce code rattache une prime, il doit
  // rester imprévisible — sans quoi on devinerait le code d'un autre pour lui
  // attribuer ses propres filleuls.
  const bytes = randomBytes(LONGUEUR_CODE);
  let code = "";
  for (let i = 0; i < LONGUEUR_CODE; i++) {
    code += BASE32[bytes[i] % BASE32.length];
  }
  return code;
}

/** Nombre de tentatives avant d'abandonner sur collision de code. Même
 *  précédent que createAssisted() pour le code-compte : la collision est rare
 *  mais possible, et un 500 brut serait injustifiable pour un tirage aléatoire. */
export const MAX_TENTATIVES_CODE = 5;
