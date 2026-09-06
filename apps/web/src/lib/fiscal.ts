// Identité fiscale d'une organisation — miroir de createOrganizationSchema
// (apps/trust-api/src/organizations/dto/create-organization.dto.ts).
//
// Recopié plutôt qu'importé : aucun package de types partagés dans ce monorepo,
// et `apps/web` ne dépend pas d'`apps/trust-api`. Le contrat est donc dupliqué
// ici EN CONNAISSANCE DE CAUSE, avec ses deux règles métier — la validation
// client n'est qu'un confort, trust-api reste seul juge et rejette de toute
// façon ce qui passerait à travers.
//
// Même discipline que permissions.ts, qui recopie les @Roles() du backend.

export const LEGAL_FORMS = ["commercial", "association"] as const;
export type LegalForm = (typeof LEGAL_FORMS)[number];

export const REGIMES_FISCAUX = ["normal_tva", "tpu", "normal_sans_tva", "non_assujetti_association"] as const;
export type RegimeFiscal = (typeof REGIMES_FISCAUX)[number];

export const LEGAL_FORM_LABELS: Record<LegalForm, string> = {
  commercial: "Entreprise commerciale",
  association: "Association",
};

export const REGIME_FISCAL_LABELS: Record<RegimeFiscal, string> = {
  normal_tva: "Régime normal — assujetti à la TVA",
  tpu: "Taxe Professionnelle Unique (TPU)",
  normal_sans_tva: "Régime normal — non assujetti à la TVA",
  non_assujetti_association: "Association non assujettie",
};

export function isLegalForm(value: string): value is LegalForm {
  return (LEGAL_FORMS as readonly string[]).includes(value);
}

export function isRegimeFiscal(value: string): value is RegimeFiscal {
  return (REGIMES_FISCAUX as readonly string[]).includes(value);
}

// I4, ADR-057 — `non_assujetti_association` porte 0 bps de TVA par nature
// (tax-regime.ts). Sans cette règle, n'importe quelle organisation commerciale
// se déclarait exonérée à la création : un vecteur de fraude fiscale direct.
//
// Le sens inverse n'est VOLONTAIREMENT pas contraint, exactement comme le DTO :
// une association peut légitimement choisir un régime imposable (activité
// commerciale accessoire). Filtrer les régimes d'une association ici
// inventerait une règle que le backend n'applique pas — et l'écran refuserait
// une organisation que l'API, elle, accepterait.
export function allowedRegimesFor(legalForm: LegalForm): readonly RegimeFiscal[] {
  if (legalForm === "association") {
    return REGIMES_FISCAUX;
  }
  return REGIMES_FISCAUX.filter((regime) => regime !== "non_assujetti_association");
}

export type FiscalField = "name" | "legalForm" | "regimeFiscal" | "nif" | "etaxNumber";

export interface FiscalViolation {
  field: FiscalField;
  message: string;
}

export interface FiscalIdentityInput {
  name: string;
  legalForm: string;
  regimeFiscal: string;
  nif: string;
  etaxNumber: string;
}

// Retourne TOUTES les violations plutôt que la première : un formulaire qui
// corrige une erreur à la fois fait recommencer l'utilisateur autant de fois
// qu'il a de fautes. L'ordre suit celui des champs à l'écran.
export function validateFiscalIdentity(input: FiscalIdentityInput): FiscalViolation[] {
  const violations: FiscalViolation[] = [];

  const name = input.name.trim();
  if (!name) {
    violations.push({ field: "name", message: "Le nom de l'organisation est requis." });
  }

  const legalFormValid = isLegalForm(input.legalForm);
  if (!legalFormValid) {
    violations.push({ field: "legalForm", message: "Choisissez une forme légale." });
  }

  const regimeValid = isRegimeFiscal(input.regimeFiscal);
  if (!regimeValid) {
    // Pas de défaut silencieux (DAT §4) : un régime non choisi est une erreur,
    // jamais un `normal_tva` supposé.
    violations.push({ field: "regimeFiscal", message: "Choisissez un régime fiscal." });
  }

  if (
    legalFormValid &&
    regimeValid &&
    input.regimeFiscal === "non_assujetti_association" &&
    input.legalForm !== "association"
  ) {
    violations.push({
      field: "regimeFiscal",
      message: "Le régime « Association non assujettie » est réservé aux associations.",
    });
  }

  // ADR-035 — NIF et eTax sont facultatifs, mais conjoints : les deux ou aucun
  // des deux. Une PME peut émettre sa première facture sans les avoir sous la
  // main, jamais avec un seul des deux.
  const nif = input.nif.trim();
  const etaxNumber = input.etaxNumber.trim();
  if ((nif === "") !== (etaxNumber === "")) {
    violations.push({
      field: nif === "" ? "nif" : "etaxNumber",
      message: "NIF et numéro eTax vont ensemble : renseignez les deux, ou aucun des deux.",
    });
  }

  return violations;
}
