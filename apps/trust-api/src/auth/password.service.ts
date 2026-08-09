import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";

export interface PasswordService {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
  generateTemporaryPassword(): string;
}

// Argon2id — recommandation OWASP actuelle (préférée à bcrypt pour un nouveau schéma).
export class Argon2PasswordService implements PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }

  // Mot de passe temporaire de récupération de compte (B3) — jamais Math.random(),
  // toujours crypto.randomBytes (CSPRNG). Alphabet volontairement restreint et
  // majuscules uniquement : le plan B3 prévoit que ce mot de passe soit transmis de
  // vive voix par le backup admin (contexte PME) — base64url (casse mixte, -, _)
  // serait pénible et source d'erreur à dicter. 0/O et 1/I/L exclus (confusion
  // classique à l'oral). 31 caractères (pas 32) : biais de modulo négligeable, sans
  // conséquence ici (pas une clé cryptographique, juste un secret à usage unique
  // dont on veut surtout une entropie suffisante et une transcription fiable — 16
  // caractères ≈ 79 bits, trente fois la marge nécessaire pour un mot de passe
  // immédiatement remplacé à la prochaine connexion).
  generateTemporaryPassword(): string {
    const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    const bytes = randomBytes(16);
    let password = "";
    for (const byte of bytes) {
      password += alphabet[byte % alphabet.length];
    }
    return password;
  }
}
