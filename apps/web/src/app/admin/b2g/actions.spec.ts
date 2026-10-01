import { beforeEach, describe, expect, it, vi } from "vitest";

// Ces deux Server Actions n'ajoutent AUCUNE autorisation : elles ne font que
// relayer le contrat DAF déjà existant (trust-api/PublicBuyerPortalService).
// Ces tests figent ce relais — validation locale, revalidatePath des deux
// écrans concernés, et le message d'erreur trust-api transmis tel quel —
// jamais l'autorisation elle-même, qui reste couverte côté trust-api
// (public-buyer-portal.service.spec.ts).

const requireSessionTokenMock = vi.fn();
const validateLiquidationMock = vi.fn();
const registerObjectionMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/session")>("@/lib/session");
  return { ...actual, requireSessionToken: () => requireSessionTokenMock() };
});

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return {
    ...actual,
    validateLiquidation: (...args: unknown[]) => validateLiquidationMock(...args),
    registerObjection: (...args: unknown[]) => registerObjectionMock(...args),
  };
});

const { validerLiquidationAction, leverObjectionAction } = await import("./actions");
const { TrustApiError } = await import("@/lib/trust-api");

beforeEach(() => {
  vi.clearAllMocks();
  requireSessionTokenMock.mockResolvedValue("jeton-daf");
});

describe("validerLiquidationAction", () => {
  it("vise le service fait et revalide /admin/b2g et /daf", async () => {
    validateLiquidationMock.mockResolvedValue({ id: "inv-1", validatedByAdministration: true });

    const result = await validerLiquidationAction({ invoiceId: "inv-1" });

    expect(validateLiquidationMock).toHaveBeenCalledWith("jeton-daf", "inv-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/b2g");
    expect(revalidatePathMock).toHaveBeenCalledWith("/daf");
    expect(result).toEqual({
      success: true,
      message: "Service fait visé. La créance est reconnue et devient finançable.",
    });
  });

  it("refuse localement une facture vide, sans appeler trust-api", async () => {
    const result = await validerLiquidationAction({ invoiceId: "  " });

    expect(result).toEqual({ success: false, error: "Facture introuvable" });
    expect(validateLiquidationMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("relaie le message trust-api sans le reformuler", async () => {
    validateLiquidationMock.mockRejectedValue(new TrustApiError("Compte acheteur public non vérifié", 403));

    const result = await validerLiquidationAction({ invoiceId: "inv-1" });

    expect(result).toEqual({ success: false, error: "Compte acheteur public non vérifié" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("leverObjectionAction", () => {
  it("enregistre l'objection et revalide /admin/b2g et /daf", async () => {
    registerObjectionMock.mockResolvedValue({ success: true, message: "Objection enregistrée. Financement gelé." });

    const result = await leverObjectionAction({ invoiceId: "inv-1", reason: "Marchandise jamais livrée" });

    expect(registerObjectionMock).toHaveBeenCalledWith("jeton-daf", "inv-1", "Marchandise jamais livrée");
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/b2g");
    expect(revalidatePathMock).toHaveBeenCalledWith("/daf");
    expect(result).toEqual({ success: true, message: "Objection enregistrée. Financement gelé." });
  });

  it("refuse localement un motif vide, sans appeler trust-api", async () => {
    const result = await leverObjectionAction({ invoiceId: "inv-1", reason: "   " });

    expect(result.success).toBe(false);
    expect(registerObjectionMock).not.toHaveBeenCalled();
  });

  it("refuse localement un motif de plus de 1000 caractères", async () => {
    const result = await leverObjectionAction({ invoiceId: "inv-1", reason: "x".repeat(1001) });

    expect(result.success).toBe(false);
    expect(registerObjectionMock).not.toHaveBeenCalled();
  });

  it("relaie le message trust-api sans le reformuler", async () => {
    registerObjectionMock.mockRejectedValue(new TrustApiError("Aucun dossier B2G public n'est associé à cette facture.", 404));

    const result = await leverObjectionAction({ invoiceId: "inv-1", reason: "Marchandise jamais livrée" });

    expect(result).toEqual({ success: false, error: "Aucun dossier B2G public n'est associé à cette facture." });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
