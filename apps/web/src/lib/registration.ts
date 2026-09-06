// Validation du formulaire d'inscription — miroir de registerSchema
// (apps/trust-api/src/auth/dto/register.dto.ts), recopié pour les mêmes
// raisons que fiscal.ts.
//
// `otpCode` du DTO n'est PAS repris ici : il ne sert qu'à réclamer un compte
// fantôme F13 (créé par le portail client), un chemin que ce tunnel
// d'inscription publique n'emprunte pas. Afficher un champ « code reçu par
// SMS » alors qu'aucune route ne l'envoie afficherait une vérification qui
// n'existe pas.

export const MSISDN_PATTERN = /^\+224\d{8,9}$/;
export const PASSWORD_MIN_LENGTH = 8;

// Le numéro est saisi au doigt, sur un téléphone, souvent avec les espaces du
// carnet d'adresses ou le 00224 de l'international. Normaliser ici évite de
// refuser un numéro correct pour une raison de typographie — le motif du DTO,
// lui, n'accepte que la forme canonique.
export function normalizeMsisdn(raw: string): string {
  const compact = raw.replace(/[\s.-]/g, "");
  if (compact === "") {
    return "";
  }
  if (compact.startsWith("+224")) {
    return compact;
  }
  if (compact.startsWith("00224")) {
    return `+${compact.slice(2)}`;
  }
  if (compact.startsWith("224")) {
    return `+${compact}`;
  }
  // Numéro local tel qu'on se le donne sur place : 6XX XX XX XX.
  if (/^\d+$/.test(compact)) {
    return `+224${compact}`;
  }
  // Rien de reconnaissable — rendu tel quel, la validation dira pourquoi.
  return compact;
}

export type RegistrationField = "name" | "msisdn" | "password";

export interface RegistrationViolation {
  field: RegistrationField;
  message: string;
}

export interface RegistrationInput {
  name: string;
  msisdn: string;
  password: string;
}

// `msisdn` est attendu DÉJÀ normalisé (normalizeMsisdn) — la fonction valide,
// elle ne répare pas : sinon l'appelant croirait valider ce qu'il a saisi
// alors qu'il valide autre chose.
export function validateRegistration(input: RegistrationInput): RegistrationViolation[] {
  const violations: RegistrationViolation[] = [];

  if (!input.name.trim()) {
    violations.push({ field: "name", message: "Votre nom est requis." });
  }

  if (!MSISDN_PATTERN.test(input.msisdn)) {
    violations.push({
      field: "msisdn",
      message: "Numéro guinéen attendu : +224 suivi de 8 ou 9 chiffres.",
    });
  }

  if (input.password.length < PASSWORD_MIN_LENGTH) {
    violations.push({
      field: "password",
      message: `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caractères.`,
    });
  }

  return violations;
}
