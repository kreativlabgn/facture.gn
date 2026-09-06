import { describe, expect, it, vi, beforeEach } from "vitest";

// requestMandateAction porte les DEUX étapes du formulaire dans une seule
// Server Action, distinguées par le champ `intent` que pose le bouton cliqué.
// Ces tests figent la frontière entre les deux : vérifier ne demande jamais un
// mandat, et demander sans avoir vérifié n'atteint jamais le réseau.

const requireSessionTokenMock = vi.fn();
const listMyPracticesMock = vi.fn();
const lookupOrganizationByNifMock = vi.fn();
const requestMandateMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireSessionToken: () => requireSessionTokenMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return {
    ...actual,
    listMyPractices: (...args: unknown[]) => listMyPracticesMock(...args),
    lookupOrganizationByNif: (...args: unknown[]) => lookupOrganizationByNifMock(...args),
    requestMandate: (...args: unknown[]) => requestMandateMock(...args),
  };
});

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("requestMandateAction — étape 1, vérification du NIF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("session-token");
    listMyPracticesMock.mockResolvedValue([{ id: "practice-1", role: "practice_admin" }]);
    lookupOrganizationByNifMock.mockResolvedValue({ id: "org-1", name: "Ets Camara" });
  });

  it("résout le NIF et rend le nom de l'organisation", async () => {
    const { requestMandateAction } = await import("./actions");

    const result = await requestMandateAction(null, buildFormData({ nif: "123456789", intent: "verify" }));

    expect(lookupOrganizationByNifMock).toHaveBeenCalledWith("session-token", "123456789");
    expect(result?.organization).toEqual({ id: "org-1", name: "Ets Camara" });
    expect(result?.nif).toBe("123456789");
  });

  // Vérifier n'engage rien : aucun mandat ne doit partir à cette étape.
  it("ne demande aucun mandat en vérifiant", async () => {
    const { requestMandateAction } = await import("./actions");

    await requestMandateAction(null, buildFormData({ nif: "123456789", intent: "verify" }));

    expect(requestMandateMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  // Sans `intent` (bouton par défaut d'un navigateur qui soumet au clavier),
  // on vérifie — jamais on n'envoie une demande par surprise.
  it("vérifie par défaut quand aucun intent n'est transmis", async () => {
    const { requestMandateAction } = await import("./actions");

    await requestMandateAction(null, buildFormData({ nif: "123456789" }));

    expect(lookupOrganizationByNifMock).toHaveBeenCalled();
    expect(requestMandateMock).not.toHaveBeenCalled();
  });

  it("relaie le message de trust-api et conserve la saisie", async () => {
    const { TrustApiError } = await import("@/lib/trust-api");
    lookupOrganizationByNifMock.mockRejectedValue(new TrustApiError("Aucune organisation ne correspond à ce NIF", 404));
    const { requestMandateAction } = await import("./actions");

    const result = await requestMandateAction(null, buildFormData({ nif: "999999999", intent: "verify" }));

    expect(result?.error).toBe("Aucune organisation ne correspond à ce NIF");
    expect(result?.nif).toBe("999999999");
    expect(result?.organization).toBeUndefined();
  });

  it("refuse un NIF vide sans appeler l'annuaire", async () => {
    const { requestMandateAction } = await import("./actions");

    const result = await requestMandateAction(null, buildFormData({ nif: "   ", intent: "verify" }));

    expect(lookupOrganizationByNifMock).not.toHaveBeenCalled();
    expect(result?.error).toContain("NIF");
  });
});

describe("requestMandateAction — étape 2, envoi de la demande", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("session-token");
    listMyPracticesMock.mockResolvedValue([{ id: "practice-1", role: "practice_admin" }]);
    requestMandateMock.mockResolvedValue({ id: "mandate-1" });
  });

  it("envoie la demande avec l'identifiant vérifié, puis remet le formulaire à zéro", async () => {
    const { requestMandateAction } = await import("./actions");

    const result = await requestMandateAction(
      null,
      buildFormData({ nif: "123456789", intent: "request", organizationId: "org-1", organizationName: "Ets Camara" }),
    );

    expect(requestMandateMock).toHaveBeenCalledWith("session-token", "practice-1", "org-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/cabinet/mandates");
    expect(result?.requestedFor).toBe("Ets Camara");
    expect(result?.organization).toBeUndefined();
    expect(result?.nif).toBeUndefined();
  });

  // La garde qui compte côté écran : sans vérification préalable, il n'y a pas
  // d'identifiant, et rien ne doit partir.
  it("refuse d'envoyer sans identifiant vérifié", async () => {
    const { requestMandateAction } = await import("./actions");

    const result = await requestMandateAction(null, buildFormData({ nif: "123456789", intent: "request" }));

    expect(requestMandateMock).not.toHaveBeenCalled();
    expect(result?.error).toContain("Vérifiez d'abord");
  });

  it("garde l'organisation à l'écran quand l'envoi échoue", async () => {
    const { TrustApiError } = await import("@/lib/trust-api");
    requestMandateMock.mockRejectedValue(new TrustApiError("Un mandat actif existe déjà pour ce cabinet", 409));
    const { requestMandateAction } = await import("./actions");

    const result = await requestMandateAction(
      null,
      buildFormData({ nif: "123456789", intent: "request", organizationId: "org-1", organizationName: "Ets Camara" }),
    );

    expect(result?.error).toContain("mandat actif");
    expect(result?.organization).toEqual({ id: "org-1", name: "Ets Camara" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("s'arrête si le compte n'est rattaché à aucun cabinet", async () => {
    listMyPracticesMock.mockResolvedValue([]);
    const { requestMandateAction } = await import("./actions");

    const result = await requestMandateAction(null, buildFormData({ nif: "123456789", intent: "verify" }));

    expect(lookupOrganizationByNifMock).not.toHaveBeenCalled();
    expect(result?.error).toContain("Aucun cabinet");
  });
});
