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

// Vente au comptoir — panier + choix du règlement. L'action ne redirige plus
// elle-même (InvoiceForm et VenteComptoirForm en font chacun ce qu'ils
// veulent) : elle doit donc toujours retourner ce que l'écran de confirmation
// a besoin d'afficher, et refuser AVANT tout appel réseau un lien de paiement
// sans numéro pour le recevoir.
describe("createAndIssueInvoiceAction — état de succès et choix du règlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton");
    resolveActiveOrganizationMock.mockResolvedValue({ active: { id: "org-1", role: "cashier" } });
    resolveCustomerByPhoneMock.mockResolvedValue({ id: "client-du-numero" });
    createInvoiceMock.mockResolvedValue({ id: "facture-1" });
    issueInvoiceMock.mockResolvedValue({
      id: "facture-1",
      number: "FG-2026-000123",
      totalTtc: "8500000",
      paymentLinkUrl: "https://pay.facture.gn/xyz",
      paymentLinkExpiresAt: "2026-09-20T00:00:00.000Z",
    });
  });

  // Ce que porte l'état de succès est EXACTEMENT ce que l'écran de
  // confirmation lit — un champ manquant ici est un champ que la confirmation
  // ne pourra jamais afficher.
  it("l'état de succès porte invoiceId, le total et le lien de paiement renvoyés par issueInvoice", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    const etat = await createAndIssueInvoiceAction(
      null,
      formulaire({ customerPhone: "622 00 00 00", settlementMode: "payment_link", linesJson: LIGNES }),
    );

    expect(etat).toEqual({
      invoiceId: "facture-1",
      number: "FG-2026-000123",
      totalTtc: "8500000",
      paymentLinkUrl: "https://pay.facture.gn/xyz",
      paymentLinkExpiresAt: "2026-09-20T00:00:00.000Z",
      settlementMode: "payment_link",
      customerPhone: "+224622000000",
    });
  });

  // LE refus doit être prononcé avant tout appel réseau : un lien de paiement
  // n'a nulle part où aller sans numéro, et l'attendre du serveur ferait
  // porter à trust-api une règle qui est purement une contrainte d'affichage
  // de ce formulaire.
  it("refuse le règlement par lien de paiement sans numéro, avant tout appel réseau", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    const etat = await createAndIssueInvoiceAction(
      null,
      formulaire({ settlementMode: "payment_link", linesJson: LIGNES }),
    );

    expect(etat).toEqual({ error: expect.stringMatching(/numéro/i) });
    expect(resolveCustomerByPhoneMock).not.toHaveBeenCalled();
    expect(createInvoiceMock).not.toHaveBeenCalled();
    expect(issueInvoiceMock).not.toHaveBeenCalled();
  });

  // Le mode espèces (par défaut, ou explicite) ne change rien au comportement
  // déjà en place : le téléphone reste facultatif.
  it("le règlement en espèces reste possible sans numéro, settlementMode absent ou explicite", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    const sansChamp = await createAndIssueInvoiceAction(null, formulaire({ linesJson: LIGNES }));
    const explicite = await createAndIssueInvoiceAction(
      null,
      formulaire({ settlementMode: "cash", linesJson: LIGNES }),
    );

    expect(sansChamp).toMatchObject({ settlementMode: "cash", customerPhone: null });
    expect(explicite).toMatchObject({ settlementMode: "cash", customerPhone: null });
    expect(resolveCustomerByPhoneMock).not.toHaveBeenCalled();
  });

  // Non-régression explicite (Test W5) : le bug corrigé par ce chantier ne
  // doit rien changer à ce qui se passait déjà pour documentType="invoice"
  // (le défaut) — createInvoice PUIS issueInvoice, invoiceId dans l'état.
  it("documentType=invoice (défaut) : createInvoice puis issueInvoice sont appelés, l'état porte invoiceId", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    const etat = await createAndIssueInvoiceAction(null, formulaire({ linesJson: LIGNES }));

    expect(createInvoiceMock).toHaveBeenCalledTimes(1);
    expect(issueInvoiceMock).toHaveBeenCalledTimes(1);
    expect(etat && "invoiceId" in etat).toBe(true);
  });
});

// ADR-064 — un devis est un document préliminaire NON engageant : le créer ne
// doit jamais tenter de l'émettre (issueInvoice() rejette tout documentType ≠
// "invoice" en 409 côté trust-api). Avant ce chantier, l'action appelait
// systématiquement issueInvoice() et le marchand voyait une erreur technique
// brute à chaque tentative de créer un devis.
describe("createAndIssueInvoiceAction — devis (documentType=quote)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton");
    resolveActiveOrganizationMock.mockResolvedValue({ active: { id: "org-1", role: "cashier" } });
    createInvoiceMock.mockResolvedValue({ id: "devis-1" });
  });

  // Test W1 — le point central du correctif : jamais d'appel à issueInvoice
  // pour un devis, quoi qu'il arrive ensuite.
  it("n'appelle jamais issueInvoice pour un devis", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    await createAndIssueInvoiceAction(
      null,
      formulaire({ documentType: "quote", linesJson: LIGNES }),
    );

    expect(createInvoiceMock).toHaveBeenCalledTimes(1);
    expect(issueInvoiceMock).not.toHaveBeenCalled();
  });

  // Test W2 — l'état de succès porte quoteId, jamais invoiceId : c'est ce qui
  // garantit que le narrowing `"invoiceId" in state` de VenteComptoirForm.tsx
  // (fichier gelé) ne matche jamais cette branche.
  it("l'état de succès porte { documentType: 'quote', quoteId } sans invoiceId", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    const etat = await createAndIssueInvoiceAction(
      null,
      formulaire({ documentType: "quote", linesJson: LIGNES }),
    );

    expect(etat).toEqual({ documentType: "quote", quoteId: "devis-1" });
    expect(etat && "invoiceId" in etat).toBe(false);
  });

  // Test W3 — quoteValidUntil est transmis tel quel, sans recalcul de fuseau
  // horaire ni reformatage (risque documenté dans le plan, non corrigé ici).
  it("transmet quoteValidUntil tel quel à createInvoice quand fourni", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    await createAndIssueInvoiceAction(
      null,
      formulaire({ documentType: "quote", quoteValidUntil: "2026-12-31", linesJson: LIGNES }),
    );

    expect(createInvoiceMock.mock.calls[0][1].quoteValidUntil).toBe("2026-12-31");
  });

  // Test W4 — non-régression du chemin facture : sans quoteValidUntil dans le
  // formulaire, la clé n'est pas envoyée implicitement.
  it("sans quoteValidUntil dans le formulaire, le payload ne porte pas la clé", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");

    await createAndIssueInvoiceAction(
      null,
      formulaire({ documentType: "quote", linesJson: LIGNES }),
    );

    expect(createInvoiceMock.mock.calls[0][1].quoteValidUntil).toBeUndefined();
  });

  it("relaie le message de TrustApiError sur échec de création", async () => {
    const { createAndIssueInvoiceAction } = await import("./actions");
    const { TrustApiError } = await import("@/lib/trust-api");
    createInvoiceMock.mockRejectedValue(new TrustApiError("Lignes de facture invalides", 400));

    const etat = await createAndIssueInvoiceAction(
      null,
      formulaire({ documentType: "quote", linesJson: LIGNES }),
    );

    expect(etat).toEqual({ error: "Lignes de facture invalides" });
  });
});
