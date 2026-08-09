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
  // toujours crypto.randomBytes (CSPRNG). base64url : pas de caractères ambigus à
  // transmettre de vive voix à problème (contrairement à hex, plus dense en entropie
  // par caractère que hex pour la même longueur affichée).
  generateTemporaryPassword(): string {
    return randomBytes(16).toString("base64url");
  }
}
