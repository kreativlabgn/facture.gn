import { describe, expect, it, vi, beforeEach } from "vitest";

// Catalogue produits/services (docs/plans/2026-09-16-catalogue-produits-services.md).
// Ce test fige ce qui ne se lit pas dans le formulaire : la conversion GNF →
// centimes du prix de vente, la distinction `null` (effacer, "sur devis" à
// nouveau) vs valeur, la case à cocher isActive traduite en booléen explicite,
// et — LE point du plan §3 — qu'aucun champ "type" n'est jamais lu ni transmis
// par cette action, quoi qu'il arrive dans le formData.

const requireSessionTokenMock = vi.fn();
const updateProductMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireSessionToken: () => requireSessionTokenMock(),
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return {
    ...actual,
    updateProduct: (...args: unknown[]) => updateProductMock(...args),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }));

function formulaire(champs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) formData.set(cle, valeur);
  return formData;
}

describe("updateProductAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton");
    updateProductMock.mockResolvedValue({ id: "produit-1" });
  });

  it("refuse un identifiant de produit manquant sans appeler trust-api", async () => {
    const { updateProductAction } = await import("./actions");

    const etat = await updateProductAction(null, formulaire({ name: "Sac de riz" }));

    expect(etat).toEqual({ error: expect.stringMatching(/identifiant/i) });
    expect(updateProductMock).not.toHaveBeenCalled();
  });

  it("refuse un nom vide sans appeler trust-api", async () => {
    const { updateProductAction } = await import("./actions");

    const etat = await updateProductAction(null, formulaire({ productId: "produit-1", name: "  " }));

    expect(etat).toEqual({ error: expect.stringMatching(/nom/i) });
    expect(updateProductMock).not.toHaveBeenCalled();
  });

  it("refuse une description de plus de 500 caractères sans appeler trust-api", async () => {
    const { updateProductAction } = await import("./actions");

    const etat = await updateProductAction(
      null,
      formulaire({ productId: "produit-1", name: "Sac de riz", description: "a".repeat(501) }),
    );

    expect(etat).toEqual({ error: expect.stringMatching(/description/i) });
    expect(updateProductMock).not.toHaveBeenCalled();
  });

  it("refuse un prix de vente négatif ou non numérique sans appeler trust-api", async () => {
    const { updateProductAction } = await import("./actions");

    const etat = await updateProductAction(
      null,
      formulaire({ productId: "produit-1", name: "Sac de riz", salePriceGnf: "abc" }),
    );

    expect(etat).toEqual({ error: expect.stringMatching(/prix/i) });
    expect(updateProductMock).not.toHaveBeenCalled();
  });

  it("envoie description=null et salePrice=null quand les champs sont vidés — efface plutôt que d'ignorer", async () => {
    const { updateProductAction } = await import("./actions");

    await updateProductAction(
      null,
      formulaire({ productId: "produit-1", name: "Sac de riz", description: "", salePriceGnf: "" }),
    );

    expect(updateProductMock).toHaveBeenCalledWith("jeton", "produit-1", {
      name: "Sac de riz",
      description: null,
      salePrice: null,
      isActive: false,
    });
  });

  it("convertit le prix de vente saisi en GNF vers des centimes avant l'appel API", async () => {
    const { updateProductAction } = await import("./actions");

    await updateProductAction(
      null,
      formulaire({ productId: "produit-1", name: "Sac de riz", salePriceGnf: "90000", isActive: "on" }),
    );

    expect(updateProductMock).toHaveBeenCalledWith("jeton", "produit-1", {
      name: "Sac de riz",
      description: null,
      salePrice: "9000000",
      isActive: true,
    });
  });

  it("ne lit ni ne transmet jamais de champ 'type', même s'il est présent dans le formData", async () => {
    const { updateProductAction } = await import("./actions");

    await updateProductAction(
      null,
      formulaire({ productId: "produit-1", name: "Sac de riz", type: "service" }),
    );

    const payload = updateProductMock.mock.calls[0][2];
    expect(payload).not.toHaveProperty("type");
  });

  it("relaie le message de TrustApiError sur échec de modification", async () => {
    const { updateProductAction } = await import("./actions");
    const { TrustApiError } = await import("@/lib/trust-api");
    updateProductMock.mockRejectedValue(new TrustApiError("Ressource introuvable", 404));

    const etat = await updateProductAction(null, formulaire({ productId: "produit-1", name: "Sac de riz" }));

    expect(etat).toEqual({ error: "Ressource introuvable" });
  });

  it("retourne une confirmation et revalide les deux écrans en cas de succès", async () => {
    const { updateProductAction } = await import("./actions");

    const etat = await updateProductAction(null, formulaire({ productId: "produit-1", name: "Sac de riz" }));

    expect(etat).toEqual({ ok: expect.stringMatching(/mis|jour|enregistr/i) });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/products/produit-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/products");
  });
});
