// Types de structure professionnelle, miroir de l'enum du DTO trust-api
// (practices/dto/create-practice.dto.ts). Repris ici plutôt qu'importés : il
// n'existe pas de paquet de types partagés dans ce monorepo, et le spec
// ci-contre confronte cette liste à celle du schéma Prisma pour qu'un ajout
// côté backend ne passe pas inaperçu.

export const PRACTICE_TYPES = ["cabinet_comptable", "gestionnaire", "fiduciaire", "cga"] as const;

export type PracticeType = (typeof PRACTICE_TYPES)[number];

export const PRACTICE_TYPE_LABELS: Record<PracticeType, string> = {
  cabinet_comptable: "Cabinet comptable",
  gestionnaire: "Gestionnaire",
  fiduciaire: "Fiduciaire",
  cga: "Centre de gestion agréé (CGA)",
};

// Le numéro d'ordre ne concerne pas tout le monde : un cabinet comptable et un
// CGA sont inscrits à un ordre ou agréés, un gestionnaire indépendant ne l'est
// pas nécessairement. Le libellé s'adapte donc, et le champ reste facultatif
// dans tous les cas — c'est ce que dit le DTO (`.optional()`).
export const PRACTICE_REGISTRATION_LABELS: Record<PracticeType, string> = {
  cabinet_comptable: "Numéro d'inscription à l'Ordre",
  gestionnaire: "Numéro d'enregistrement",
  fiduciaire: "Numéro d'enregistrement",
  cga: "Numéro d'agrément",
};

export function isPracticeType(value: string): value is PracticeType {
  return (PRACTICE_TYPES as readonly string[]).includes(value);
}

export function practiceTypeLabel(value: string): string {
  return isPracticeType(value) ? PRACTICE_TYPE_LABELS[value] : value;
}

export type PracticeField = "name" | "type" | "phone" | "email";

export interface PracticeViolation {
  field: PracticeField;
  message: string;
}

// Validation côté serveur AVANT l'appel réseau — pas pour remplacer celle de
// trust-api (qui reste seule juge), mais pour rendre à l'utilisateur un message
// par champ plutôt qu'une erreur globale. Le format msisdn est celui du DTO
// partagé : +224 suivi de 8 ou 9 chiffres.
const MSISDN = /^\+224\d{8,9}$/;
// Volontairement permissif : la validation d'e-mail par expression régulière
// est un piège connu. On écarte les fautes de frappe évidentes, trust-api (Zod
// .email()) tranche le reste.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePractice(input: {
  name: string;
  type: string;
  phone: string;
  email: string;
}): PracticeViolation[] {
  const violations: PracticeViolation[] = [];

  if (input.name.trim().length === 0) {
    violations.push({ field: "name", message: "Le nom du cabinet est requis." });
  }
  if (!isPracticeType(input.type)) {
    violations.push({ field: "type", message: "Choisissez un type de structure." });
  }
  if (!MSISDN.test(input.phone)) {
    violations.push({
      field: "phone",
      message: "Numéro attendu au format +224 suivi de 8 ou 9 chiffres.",
    });
  }
  // Facultatif : on ne valide que s'il est renseigné.
  if (input.email.length > 0 && !EMAIL.test(input.email)) {
    violations.push({ field: "email", message: "Adresse e-mail invalide." });
  }

  return violations;
}
