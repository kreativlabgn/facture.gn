import { describe, expect, it, vi, beforeEach } from "vitest";

// ADR-106 — vente au comptoir. Ce test fige le seul comportement qui ne se lit
// pas dans le formulaire : QUAND l'action résout un numéro de téléphone en
// client, et sous quelle forme le numéro part vers trust-api. Une facture
// rattachée au mauvais client, ou un numéro envoyé sous deux écritures
// différentes, ne se voit pas à l'écran — mais casse le dédoublonnage.

const requireSessionTokenMock = vi.fn();
const resolveActiveOrganizationMock = vi.fn();
const resolveCustomerByPhoneMock = vi.fn();
const createInvoiceMock = vi.fn();
const issueInvoiceMock = vi.fn();
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
    resolveCustomerByPhone: (...args: unknown[]) => resolveCustomerByPhoneMock(...args),
    createInvoice: (...args: unknown[]) => createInvoiceMock(...args),
    issueInvoice: (...args: unknown[]) => issueInvoiceMock(...args),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (...args: unknown[]) => redirectMock(...args) }));

const LIGNES = JSON.stringify([{ description: "Sac de riz", quantity: 1, unitPriceGnf: 85000 }]);

function formulaire(champs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) formData.set(cle, valeur);
  return formData;
}

describe("createAndIssueInvoiceAction — rattachement du client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton");
    resolveActiveOrganizationMock.mockResolvedValue({ active: { id: "org-1", role: "cashier" } });
    resolveCustomerByPhoneMock.mockResolvedValue({ id: "client-du-numero" });
    createInvoiceMock.mockResolvedValue({ id: "facture-1" });
    issueInvoiceMock.mockResolvedValue({ id: "facture-1" });
  });

  // LE point du parcours : le commerçant tape neuf chiffres, le serveur reçoit
  // le format canonique. La normalisation ne se fait QU'ICI (le serveur refuse
  // toute autre écriture) — sans quoi deux formes du même numéro entreraient
  // en base et le dédoublonnage ne dédoublonnerait plus rien.
  it("normalise le numéro à 9 chiffres avant de le résoudre en client", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    await createAndIssueInvoiceAction(null, formulaire({ customerPhone: "622 00 00 00", linesJson: LIGNES }));

    expect(resolveCustomerByPhoneMock).toHaveBeenCalledWith("jeton", "org-1", "+224622000000");
    expect(createInvoiceMock.mock.calls[0][1].customerId).toBe("client-du-numero");
  });

  // Le numéro n'atteint JAMAIS le réseau s'il ne peut pas être un numéro
  // guinéen : le refus est immédiat et dit quoi corriger, plutôt qu'un 400
  // traduit depuis un message de schéma.
  it("refuse un numéro invalide sans appeler trust-api", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    const etat = await createAndIssueInvoiceAction(null, formulaire({ customerPhone: "62200", linesJson: LIGNES }));

    expect(etat).toEqual({ error: expect.stringMatching(/numéro/i) });
    expect(resolveCustomerByPhoneMock).not.toHaveBeenCalled();
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  // Une fiche choisie dans la liste est un choix EXPLICITE du commerçant : un
  // numéro laissé dans le champ ne doit pas la remplacer en silence.
  it("une fiche client choisie l'emporte sur le champ téléphone", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    await createAndIssueInvoiceAction(
      null,
      formulaire({ customerId: "client-choisi", customerPhone: "622000000", linesJson: LIGNES }),
    );

    expect(resolveCustomerByPhoneMock).not.toHaveBeenCalled();
    expect(createInvoiceMock.mock.calls[0][1].customerId).toBe("client-choisi");
  });

  // La facture anonyme reste possible — c'est le cas d'usage d'origine, et le
  // parcours au numéro s'ajoute à côté sans le supprimer.
  it("sans client ni numéro, la facture reste anonyme", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    await createAndIssueInvoiceAction(null, formulaire({ linesJson: LIGNES }));

    expect(resolveCustomerByPhoneMock).not.toHaveBeenCalled();
    expect(createInvoiceMock.mock.calls[0][1].customerId).toBeUndefined();
  });
});
