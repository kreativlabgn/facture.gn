import { describe, expect, it, vi, beforeEach } from "vitest";

// Bascule du canal WhatsApp de saisie OCR (plan 2026-09-16, OCR multicanal
// vocal/WhatsApp, clarification 7). Même patron que
// products/[id]/actions.spec.ts : ce test fige ce qui ne se lit pas dans le
// formulaire — la case décochée qui se lit comme `false` (jamais "ne pas
// toucher"), et surtout que l'organisation ciblée vient TOUJOURS de
// resolveActiveOrganization côté serveur, jamais d'un id de formulaire.

const requireSessionTokenMock = vi.fn();
const resolveActiveOrganizationMock = vi.fn();
const setWhatsappOcrChannelMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireSessionToken: () => requireSessionTokenMock(),
}));

vi.mock("@/lib/active-organization", () => ({
  resolveActiveOrganization: (...args: unknown[]) => resolveActiveOrganizationMock(...args),
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return {
    ...actual,
    setWhatsappOcrChannel: (...args: unknown[]) => setWhatsappOcrChannelMock(...args),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }));

function formulaire(champs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) formData.set(cle, valeur);
  return formData;
}

describe("setWhatsappOcrChannelAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton");
    resolveActiveOrganizationMock.mockResolvedValue({ active: { id: "org-1" } });
    setWhatsappOcrChannelMock.mockResolvedValue({ id: "org-1", whatsappOcrEnabled: true });
  });

  it("refuse l'action sans organisation active, sans appeler trust-api", async () => {
    resolveActiveOrganizationMock.mockResolvedValue({ active: null });
    const { setWhatsappOcrChannelAction } = await import("./actions");

    const etat = await setWhatsappOcrChannelAction(null, formulaire({ whatsappOcrEnabled: "on" }));

    expect(etat).toEqual({ error: expect.stringMatching(/organisation/i) });
    expect(setWhatsappOcrChannelMock).not.toHaveBeenCalled();
  });

  it("ignore tout id d'organisation transmis dans le formData — seule l'organisation active compte", async () => {
    const { setWhatsappOcrChannelAction } = await import("./actions");

    await setWhatsappOcrChannelAction(
      null,
      formulaire({ organizationId: "org-usurpee", whatsappOcrEnabled: "on" }),
    );

    expect(setWhatsappOcrChannelMock).toHaveBeenCalledWith("jeton", "org-1", true);
  });

  it("traduit une case décochée (absente du formData) en `false`, jamais en 'ne pas toucher'", async () => {
    const { setWhatsappOcrChannelAction } = await import("./actions");

    await setWhatsappOcrChannelAction(null, formulaire({}));

    expect(setWhatsappOcrChannelMock).toHaveBeenCalledWith("jeton", "org-1", false);
  });

  it("relaie le message de TrustApiError sur échec de modification", async () => {
    const { setWhatsappOcrChannelAction } = await import("./actions");
    const { TrustApiError } = await import("@/lib/trust-api");
    setWhatsappOcrChannelMock.mockRejectedValue(new TrustApiError("Accès refusé", 403));

    const etat = await setWhatsappOcrChannelAction(null, formulaire({ whatsappOcrEnabled: "on" }));

    expect(etat).toEqual({ error: "Accès refusé" });
  });

  it("retourne une confirmation et revalide les deux écrans en cas de succès", async () => {
    const { setWhatsappOcrChannelAction } = await import("./actions");

    const etat = await setWhatsappOcrChannelAction(null, formulaire({ whatsappOcrEnabled: "on" }));

    expect(etat).toEqual({ ok: expect.stringMatching(/activ/i) });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/settings/organisation");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/settings");
  });
});
