import * as argon2 from "argon2";

export interface PasswordService {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

// Argon2id — recommandation OWASP actuelle (préférée à bcrypt pour un nouveau schéma).
export class Argon2PasswordService implements PasswordService {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain);
  }
}
