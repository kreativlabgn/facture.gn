import { describe, expect, it } from "vitest";
import { createOrganizationSchema } from "./create-organization.dto";

describe("createOrganizationSchema", () => {
  it("rejette une organisation sans régime fiscal — jamais de défaut TVA silencieux", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      legalForm: "commercial",
      nif: "GN12345678",
      etaxNumber: "ETAX-001",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["regimeFiscal"]);
  });

  it("accepte une organisation avec régime fiscal explicite", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      regimeFiscal: "tpu",
      legalForm: "commercial",
      nif: "GN12345678",
      etaxNumber: "ETAX-001",
    });

    expect(result.success).toBe(true);
  });

  it("rejette un régime fiscal hors des 4 valeurs autorisées", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      regimeFiscal: "exoneree_invente",
      legalForm: "commercial",
      nif: "GN12345678",
      etaxNumber: "ETAX-001",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["regimeFiscal"]);
  });
});

describe("createOrganizationSchema — NIF/eTax optionnels à l'inscription (B1/B4, ADR-035)", () => {
  it("accepte une inscription sans NIF ni eTax — Chemin A self-service, TTV < 5 min", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      regimeFiscal: "tpu",
      legalForm: "commercial",
    });

    expect(result.success).toBe(true);
  });

  it("rejette un NIF fourni sans eTax — exigés conjointement (ADR-035)", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      regimeFiscal: "tpu",
      legalForm: "commercial",
      nif: "GN12345678",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["nif"]);
    expect(result.error.issues[0]?.message).toContain("ADR-035");
  });

  it("rejette un eTax fourni sans NIF — exigés conjointement (ADR-035)", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      regimeFiscal: "tpu",
      legalForm: "commercial",
      etaxNumber: "ETAX-001",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["nif"]);
    expect(result.error.issues[0]?.message).toContain("ADR-035");
  });

  it("accepte NIF et eTax fournis ensemble", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      regimeFiscal: "tpu",
      legalForm: "commercial",
      nif: "GN12345678",
      etaxNumber: "ETAX-001",
    });

    expect(result.success).toBe(true);
  });
});

describe("createOrganizationSchema — exonération association réservée aux associations (I4, ADR-057)", () => {
  it("rejette regimeFiscal=non_assujetti_association pour une organisation legalForm=commercial", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Boutique Aissatou",
      regimeFiscal: "non_assujetti_association",
      legalForm: "commercial",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["regimeFiscal"]);
    expect(result.error.issues[0]?.message).toContain("I4, ADR-057");
  });

  it("accepte regimeFiscal=non_assujetti_association pour une organisation legalForm=association", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Association Culturelle Fatoumata",
      regimeFiscal: "non_assujetti_association",
      legalForm: "association",
    });

    expect(result.success).toBe(true);
  });

  it("accepte une association avec un régime non exonéré (activité commerciale accessoire imposable)", () => {
    const result = createOrganizationSchema.safeParse({
      name: "Association Culturelle Fatoumata",
      regimeFiscal: "normal_tva",
      legalForm: "association",
    });

    expect(result.success).toBe(true);
  });
});
