import { describe, expect, it } from "vitest";
import {
  allowedRegimesFor,
  isLegalForm,
  isRegimeFiscal,
  validateFiscalIdentity,
  type FiscalIdentityInput,
} from "./fiscal";

const valid: FiscalIdentityInput = {
  name: "Boutique Aissatou",
  legalForm: "commercial",
  regimeFiscal: "normal_tva",
  nif: "",
  etaxNumber: "",
};

const fields = (input: FiscalIdentityInput) => validateFiscalIdentity(input).map((violation) => violation.field);

describe("fiscal — formes légales et régimes", () => {
  it("accepte une PME commerciale au régime normal sans NIF ni eTax (ADR-035)", () => {
    expect(validateFiscalIdentity(valid)).toEqual([]);
  });

  it("rejette une valeur hors énumération plutôt que de la laisser filer au backend", () => {
    expect(isLegalForm("sarl")).toBe(false);
    expect(isRegimeFiscal("micro")).toBe(false);
    expect(fields({ ...valid, legalForm: "sarl", regimeFiscal: "micro" })).toEqual(["legalForm", "regimeFiscal"]);
  });

  // Pas de défaut TVA silencieux (DAT §4) : un champ vide est une erreur, pas
  // un normal_tva supposé.
  it("exige un choix explicite de régime", () => {
    expect(fields({ ...valid, regimeFiscal: "" })).toEqual(["regimeFiscal"]);
  });
});

describe("fiscal — I4/ADR-057, exonération association", () => {
  it("refuse non_assujetti_association à une organisation commerciale", () => {
    const violations = validateFiscalIdentity({
      ...valid,
      regimeFiscal: "non_assujetti_association",
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe("regimeFiscal");
    expect(violations[0].message).toContain("réservé aux associations");
  });

  it("l'autorise à une association", () => {
    expect(
      validateFiscalIdentity({
        ...valid,
        legalForm: "association",
        regimeFiscal: "non_assujetti_association",
      }),
    ).toEqual([]);
  });

  // Le DTO ne contraint volontairement PAS ce sens : une association peut avoir
  // une activité commerciale accessoire imposable. L'écran ne doit donc pas
  // filtrer plus que l'API.
  it("laisse une association choisir un régime imposable", () => {
    expect(validateFiscalIdentity({ ...valid, legalForm: "association", regimeFiscal: "normal_tva" })).toEqual([]);
    expect(allowedRegimesFor("association")).toHaveLength(4);
  });

  it("retire le régime association de la liste proposée à une commerciale", () => {
    expect(allowedRegimesFor("commercial")).not.toContain("non_assujetti_association");
    expect(allowedRegimesFor("commercial")).toHaveLength(3);
  });
});

describe("fiscal — NIF et eTax conjoints (ADR-035)", () => {
  it("accepte les deux ensemble", () => {
    expect(validateFiscalIdentity({ ...valid, nif: "123456789", etaxNumber: "ETAX-42" })).toEqual([]);
  });

  it("refuse un NIF seul, et signale le champ manquant", () => {
    const violations = validateFiscalIdentity({ ...valid, nif: "123456789" });
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe("etaxNumber");
  });

  it("refuse un eTax seul, et signale le champ manquant", () => {
    const violations = validateFiscalIdentity({ ...valid, etaxNumber: "ETAX-42" });
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe("nif");
  });

  // Un champ rempli d'espaces n'est pas un champ rempli — sinon la paire
  // paraît symétrique côté écran et le backend la refuse quand même.
  it("traite un champ d'espaces comme vide", () => {
    expect(fields({ ...valid, nif: "123456789", etaxNumber: "   " })).toEqual(["etaxNumber"]);
    expect(validateFiscalIdentity({ ...valid, nif: "  ", etaxNumber: "  " })).toEqual([]);
  });
});

describe("fiscal — cumul", () => {
  it("remonte toutes les violations d'un coup, dans l'ordre des champs", () => {
    expect(
      fields({ name: "  ", legalForm: "", regimeFiscal: "non_assujetti_association", nif: "123456789", etaxNumber: "" }),
    ).toEqual(["name", "legalForm", "etaxNumber"]);
  });
});
