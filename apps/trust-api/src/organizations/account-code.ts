import { randomBytes } from "node:crypto";

// ADR-046/047 — code-compte pour la connexion PIN du Chemin B (D2, pas encore
// construit). Alphabet Base32 RFC4648 standard (A-Z2-7, sans padding) : lisible à
// l'oral par un agent terrain, pas de 0/1/O/I ambigus grâce à l'alphabet standard.
// crypto.randomBytes (jamais Math.random, non cryptographiquement sûr) — même si ce
// code n'est pas un secret d'authentification à lui seul (couplé à un PIN côté D2),
// il identifie une organisation et doit rester imprévisible.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ACCOUNT_CODE_LENGTH = 8;

export function generateAccountCode(): string {
  const bytes = randomBytes(ACCOUNT_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < ACCOUNT_CODE_LENGTH; i++) {
    code += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return code;
}
