import { describe, expect, it, vi, beforeEach } from "vitest";

// Catalogue produits/services (docs/plans/2026-09-16-catalogue-produits-services.md).
// Ce test fige ce qui ne se lit pas dans le formulaire : la conversion GNF →
// centimes du prix de vente (même discipline que createAndIssueInvoiceAction),
// le refus d'un type manquant/hors énumération AVANT tout appel réseau (le
// seul champ structurellement requis en plus de `name`), et le fait qu'un
// prix de vente vide reste absent du payload — catégorie "sur devis".

const requireSessionTokenMock = vi.fn();
const resolveActiveOrganizationMock = vi.fn();
const createProductMock = vi.fn();
const revalidatePathMock = vi.fn();
const redirectMock = vi.fn();

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
    createProduct: (...args: unknown[]) => createProductMock(...args),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }));
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => redirectMock(...args) }));

function formulaire(champs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) formData.set(cle, valeur);
  return formData;
}

describe("createProductAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton");
    resolveActiveOrganizationMock.mockResolvedValue({ active: { id: "org-1", role: "owner" } });
    createProductMock.mockResolvedValue({ id: "produit-1" });
  });

  it("refuse un nom vide sans appeler trust-api", async () => {
    const { createProductAction } = await import("./actions");

    const etat = await createProductAction(null, formulaire({ type: "product" }));

    expect(etat).toEqual({ error: expect.stringMatching(/nom/i) });
    expect(createProductMock).not.toHaveBeenCalled();
  });

  it("refuse un type manquant ou hors énumération sans appeler trust-api", async () => {
    const { createProductAction } = await import("./actions");

    const etat = await createProductAction(null, formulaire({ name: "Sac de riz" }));

    expect(etat).toEqual({ error: expect.stringMatching(/type/i) });
    expect(createProductMock).not.toHaveBeenCalled();
  });

  it("refuse une description de plus de 500 caractères sans appeler trust-api", async () => {
    const { createProductAction } = await import("./actions");

    const etat = await createProductAction(
      null,
      formulaire({ name: "Sac de riz", type: "product", description: "a".repeat(501) }),
    );

    expect(etat).toEqual({ error: expect.stringMatching(/description/i) });
    expect(createProductMock).not.toHaveBeenCalled();
  });

  it("refuse un prix de vente négatif ou non numérique sans appeler trust-api", async () => {
    const { createProductAction } = await import("./actions");

    const etat = await createProductAction(
      null,
      formulaire({ name: "Sac de riz", type: "product", salePriceGnf: "-100" }),
    );

    expect(etat).toEqual({ error: expect.stringMatching(/prix/i) });
    expect(createProductMock).not.toHaveBeenCalled();
  });

  it("convertit le prix de vente saisi en GNF vers des centimes avant l'appel API", async () => {
    const { createProductAction } = await import("./actions");

    await createProductAction(
      null,
      formulaire({ name: "Sac de riz", type: "product", salePriceGnf: "85000" }),
    );

    expect(createProductMock).toHaveBeenCalledWith("jeton", {
      organizationId: "org-1",
      name: "Sac de riz",
      type: "product",
      description: undefined,
      salePrice: "8500000",
    });
  });

  it("laisse salePrice absent quand le champ est vide — produit sur devis", async () => {
    const { createProductAction } = await import("./actions");

    await createProductAction(null, formulaire({ name: "Conseil comptable", type: "service" }));

    expect(createProductMock.mock.calls[0][1].salePrice).toBeUndefined();
  });

  it("redirige vers la fiche du produit créé", async () => {
    const { createProductAction } = await import("./actions");

    await createProductAction(null, formulaire({ name: "Sac de riz", type: "product" }));

    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/products");
    expect(redirectMock).toHaveBeenCalledWith("/dashboard/products/produit-1");
  });

  it("relaie le message de TrustApiError sur échec de création, sans rediriger", async () => {
    const { createProductAction } = await import("./actions");
    const { TrustApiError } = await import("@/lib/trust-api");
    createProductMock.mockRejectedValue(new TrustApiError("Ce nom existe déjà", 400));

    const etat = await createProductAction(null, formulaire({ name: "Sac de riz", type: "product" }));

    expect(etat).toEqual({ error: "Ce nom existe déjà" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("renvoie une erreur générique quand aucune organisation n'est active", async () => {
    resolveActiveOrganizationMock.mockResolvedValue({ active: null });
    const { createProductAction } = await import("./actions");

    const etat = await createProductAction(null, formulaire({ name: "Sac de riz", type: "product" }));

    expect(etat).toEqual({ error: expect.stringMatching(/organisation/i) });
    expect(createProductMock).not.toHaveBeenCalled();
  });
});
