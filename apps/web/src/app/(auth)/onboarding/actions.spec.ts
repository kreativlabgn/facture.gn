import { describe, expect, it, vi, beforeEach } from "vitest";

// createOrganizationAction porte la structure fiscale de la PME jusqu'à
// trust-api. Deux comportements méritent d'être figés : les champs facultatifs
// doivent être OMIS et non envoyés vides (le DTO impose .min(1), une chaîne
// vide serait rejetée là où l'absence est valide), et les deux règles métier
// doivent bloquer AVANT l'appel réseau.

const requireSessionTokenMock = vi.fn();
const createOrganizationMock = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireSessionToken: () => requireSessionTokenMock(),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return {
    ...actual,
    createOrganization: (...args: unknown[]) => createOrganizationMock(...args),
  };
});

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

const valid = {
  name: "Boutique Aissatou",
  legalForm: "commercial",
  regimeFiscal: "normal_tva",
};

describe("createOrganizationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("session-token");
    createOrganizationMock.mockResolvedValue({ id: "org-1" });
  });

  it("crée l'organisation et envoie vers le tableau de bord", async () => {
    const { createOrganizationAction } = await import("./actions");

    await createOrganizationAction(null, buildFormData(valid));

    expect(createOrganizationMock).toHaveBeenCalledWith("session-token", {
      name: "Boutique Aissatou",
      legalForm: "commercial",
      regimeFiscal: "normal_tva",
      nif: undefined,
      etaxNumber: undefined,
    });
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("transmet NIF et eTax quand les deux sont fournis", async () => {
    const { createOrganizationAction } = await import("./actions");

    await createOrganizationAction(null, buildFormData({ ...valid, nif: "123456789", etaxNumber: "ETAX-42" }));

    expect(createOrganizationMock).toHaveBeenCalledWith(
      "session-token",
      expect.objectContaining({ nif: "123456789", etaxNumber: "ETAX-42" }),
    );
  });

  // ADR-035 — la paire est conjointe : un NIF seul n'atteint jamais le réseau.
  it("refuse un NIF sans eTax, sans appeler l'API", async () => {
    const { createOrganizationAction } = await import("./actions");

    const result = await createOrganizationAction(null, buildFormData({ ...valid, nif: "123456789" }));

    expect(createOrganizationMock).not.toHaveBeenCalled();
    expect(result?.fieldErrors?.etaxNumber).toBeDefined();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  // I4/ADR-057 — l'exonération association réservée aux associations. La règle
  // est tenue côté serveur, pas seulement par le filtrage du <select> : un
  // formulaire soumis sans JavaScript la contournerait sinon.
  it("refuse l'exonération association à une organisation commerciale", async () => {
    const { createOrganizationAction } = await import("./actions");

    const result = await createOrganizationAction(
      null,
      buildFormData({ ...valid, regimeFiscal: "non_assujetti_association" }),
    );

    expect(createOrganizationMock).not.toHaveBeenCalled();
    expect(result?.fieldErrors?.regimeFiscal).toContain("réservé aux associations");
  });

  it("l'accepte pour une association", async () => {
    const { createOrganizationAction } = await import("./actions");

    await createOrganizationAction(
      null,
      buildFormData({ ...valid, legalForm: "association", regimeFiscal: "non_assujetti_association" }),
    );

    expect(createOrganizationMock).toHaveBeenCalled();
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("exige un régime explicite — aucun défaut TVA silencieux", async () => {
    const { createOrganizationAction } = await import("./actions");

    const result = await createOrganizationAction(null, buildFormData({ ...valid, regimeFiscal: "" }));

    expect(createOrganizationMock).not.toHaveBeenCalled();
    expect(result?.fieldErrors?.regimeFiscal).toBeDefined();
  });

  it("relaie le message d'erreur de trust-api et reste sur l'écran", async () => {
    const { TrustApiError } = await import("@/lib/trust-api");
    createOrganizationMock.mockRejectedValue(new TrustApiError("NIF et eTax sont exigés conjointement", 400));
    const { createOrganizationAction } = await import("./actions");

    const result = await createOrganizationAction(null, buildFormData(valid));

    expect(result?.error).toBe("NIF et eTax sont exigés conjointement");
    expect(result?.values?.name).toBe("Boutique Aissatou");
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
