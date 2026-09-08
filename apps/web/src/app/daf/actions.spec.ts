import { beforeEach, describe, expect, it, vi } from "vitest";

// J1 — les Server Actions de la console acheteur public. Ce qui est figé ici :
// l'identifiant transmis à trust-api, et le fait qu'un refus de l'API (403/409)
// ressorte comme un message LISIBLE plutôt qu'en exception non rattrapée. Les
// règles d'affichage, elles, sont testées séparément (lib/daf.spec.ts) — elles
// n'ont pas besoin d'un mock réseau pour être éprouvées.

const requireSessionTokenMock = vi.fn();
const validateLiquidationMock = vi.fn();
const confirmCustomerLinkMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireSessionToken: () => requireSessionTokenMock(),
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return {
    ...actual,
    validateLiquidation: (...args: unknown[]) => validateLiquidationMock(...args),
    confirmCustomerLink: (...args: unknown[]) => confirmCustomerLinkMock(...args),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { confirmCustomerLinkAction, validateLiquidationAction } = await import("./actions");
const { TrustApiError } = await import("@/lib/trust-api");

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("validateLiquidationAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton-daf");
  });

  it("transmet le jeton de session et l'identifiant de facture à trust-api", async () => {
    validateLiquidationMock.mockResolvedValue({ id: "inv-1" });

    const state = await validateLiquidationAction(null, buildFormData({ invoiceId: "inv-1" }));

    expect(validateLiquidationMock).toHaveBeenCalledWith("jeton-daf", "inv-1");
    expect(state).toEqual({ ok: expect.stringContaining("Service fait visé") });
  });

  it("rafraîchit la console après un visa réussi", async () => {
    validateLiquidationMock.mockResolvedValue({ id: "inv-1" });

    await validateLiquidationAction(null, buildFormData({ invoiceId: "inv-1" }));

    expect(revalidatePathMock).toHaveBeenCalledWith("/daf");
  });

  it("refuse un formulaire sans identifiant sans jamais appeler l'API", async () => {
    const state = await validateLiquidationAction(null, buildFormData({ invoiceId: "   " }));

    expect(validateLiquidationMock).not.toHaveBeenCalled();
    expect(state).toEqual({ error: "Facture introuvable" });
  });

  // Le message de l'API est relayé TEL QUEL : il distingue « pas une facture
  // B2G », « compte non vérifié » et « rattachement non confirmé ». Le
  // reformuler ici rendrait ces trois refus indistincts pour le DAF.
  it("relaie le message d'un refus 403 sans le reformuler", async () => {
    validateLiquidationMock.mockRejectedValue(
      new TrustApiError("Aucun accès à ce compte acheteur public", 403),
    );

    const state = await validateLiquidationAction(null, buildFormData({ invoiceId: "inv-1" }));

    expect(state).toEqual({ error: "Aucun accès à ce compte acheteur public" });
  });

  // 409 = draft ou voided (aucune créance à liquider). Il ressort comme un
  // message, jamais comme une exception opaque remontée à l'error boundary.
  it("relaie un 409 comme un message lisible, jamais une erreur non rattrapée", async () => {
    validateLiquidationMock.mockRejectedValue(
      new TrustApiError("Facture inv-1 annulée (voided) — aucune dette à liquider", 409),
    );

    const state = await validateLiquidationAction(null, buildFormData({ invoiceId: "inv-1" }));

    expect(state).toEqual({ error: "Facture inv-1 annulée (voided) — aucune dette à liquider" });
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("masque une panne réseau derrière un message générique", async () => {
    validateLiquidationMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const state = await validateLiquidationAction(null, buildFormData({ invoiceId: "inv-1" }));

    expect(state).toEqual({ error: "Visa temporairement indisponible" });
  });

  // Un double clic n'est PAS un cas d'erreur : validateLiquidation() est
  // idempotent côté service (200, aucun second InvoiceEvent). Les deux appels
  // doivent donc réussir — si ce test tombe, c'est qu'une garde optimiste a été
  // ajoutée côté web et qu'elle contredit le contrat du service.
  it("reste sans erreur sur un double envoi — le service est idempotent", async () => {
    validateLiquidationMock.mockResolvedValue({ id: "inv-1", validatedByAdministration: true });

    const premier = await validateLiquidationAction(null, buildFormData({ invoiceId: "inv-1" }));
    const second = await validateLiquidationAction(premier, buildFormData({ invoiceId: "inv-1" }));

    expect(second).toEqual({ ok: expect.stringContaining("Service fait visé") });
    expect(validateLiquidationMock).toHaveBeenCalledTimes(2);
  });
});

describe("confirmCustomerLinkAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton-daf");
  });

  it("transmet le jeton et l'identifiant client, puis rafraîchit la console", async () => {
    confirmCustomerLinkMock.mockResolvedValue(undefined);

    const state = await confirmCustomerLinkAction(null, buildFormData({ customerId: "cust-1" }));

    expect(confirmCustomerLinkMock).toHaveBeenCalledWith("jeton-daf", "cust-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/daf");
    expect(state).toEqual({ ok: expect.stringContaining("Rattachement confirmé") });
  });

  it("refuse un formulaire sans identifiant client sans appeler l'API", async () => {
    const state = await confirmCustomerLinkAction(null, buildFormData({ customerId: "" }));

    expect(confirmCustomerLinkMock).not.toHaveBeenCalled();
    expect(state).toEqual({ error: "Client introuvable" });
  });

  it("relaie le refus de l'API", async () => {
    confirmCustomerLinkMock.mockRejectedValue(
      new TrustApiError("Aucun accès à ce compte acheteur public", 403),
    );

    const state = await confirmCustomerLinkAction(null, buildFormData({ customerId: "cust-1" }));

    expect(state).toEqual({ error: "Aucun accès à ce compte acheteur public" });
  });
});
