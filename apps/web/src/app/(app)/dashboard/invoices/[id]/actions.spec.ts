import { beforeEach, describe, expect, it, vi } from "vitest";

// K4/K5, ADR-088/089 — la Server Action d'arbitrage du rail de financement.
// Ce qui est figé ici : le contenu exact transmis à trust-api, le refus des
// saisies qui ne peuvent produire qu'un 400 de schéma, et surtout le
// comportement sous DOUBLE CLIC — le seul scénario où l'invariant
// anti-double-financement se joue vraiment.
//
// Les règles d'affichage (qui voit la section, dans quel état) sont testées
// séparément dans lib/financing.spec.ts : elles n'ont besoin d'aucun mock.

const requireSessionTokenMock = vi.fn();
const chooseFinancingMock = vi.fn();
const convertToInvoiceMock = vi.fn();
const revalidatePathMock = vi.fn();

vi.mock("@/lib/session", () => ({
  requireSessionToken: () => requireSessionTokenMock(),
}));

vi.mock("@/lib/trust-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/trust-api")>("@/lib/trust-api");
  return {
    ...actual,
    chooseFinancing: (...args: unknown[]) => chooseFinancingMock(...args),
    convertToInvoice: (...args: unknown[]) => convertToInvoiceMock(...args),
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

const { chooseFinancingAction, convertToInvoiceAction } = await import("./actions");
const { TrustApiError } = await import("@/lib/trust-api");

function formulaire(fields: Record<string, string> = {}): FormData {
  const formData = new FormData();
  const defauts = {
    invoiceId: "inv-1",
    financialPartnerId: "11111111-1111-4111-8111-111111111111",
    disbursementMethod: "payment_link_payout",
    ...fields,
  };
  for (const [key, value] of Object.entries(defauts)) {
    if (value !== "") {
      formData.set(key, value);
    }
  }
  return formData;
}

describe("chooseFinancingAction — transmission à trust-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton-pme");
  });

  it("transmet le jeton de session, la facture et le choix complet", async () => {
    chooseFinancingMock.mockResolvedValue(undefined);

    const state = await chooseFinancingAction(null, formulaire());

    expect(chooseFinancingMock).toHaveBeenCalledWith("jeton-pme", "inv-1", {
      financialPartnerId: "11111111-1111-4111-8111-111111111111",
      disbursementMethod: "payment_link_payout",
    });
    expect(state).toEqual({ ok: expect.stringContaining("Créance cédée") });
  });

  it("rafraîchit le détail, la liste et le tableau de bord après une cession", async () => {
    chooseFinancingMock.mockResolvedValue(undefined);

    await chooseFinancingAction(null, formulaire());

    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/invoices/inv-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/invoices");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("accepte le virement bancaire comme mode de versement", async () => {
    chooseFinancingMock.mockResolvedValue(undefined);

    await chooseFinancingAction(null, formulaire({ disbursementMethod: "bank_transfer" }));

    expect(chooseFinancingMock).toHaveBeenCalledWith(
      "jeton-pme",
      "inv-1",
      expect.objectContaining({ disbursementMethod: "bank_transfer" }),
    );
  });
});

describe("chooseFinancingAction — saisies incomplètes ou forgées", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton-pme");
  });

  it("refuse une facture sans identifiant, sans rien appeler", async () => {
    const state = await chooseFinancingAction(null, formulaire({ invoiceId: "" }));

    expect(state).toEqual({ error: expect.stringContaining("identifiant de facture"), conflit: false });
    expect(chooseFinancingMock).not.toHaveBeenCalled();
  });

  it("refuse une cession sans établissement choisi", async () => {
    const state = await chooseFinancingAction(null, formulaire({ financialPartnerId: "" }));

    expect(state).toEqual({ error: expect.stringContaining("établissement financier"), conflit: false });
    expect(chooseFinancingMock).not.toHaveBeenCalled();
  });

  // Un POST rejoué hors du navigateur peut porter n'importe quelle valeur. Le
  // DTO zod de trust-api la refuserait de toute façon — mais par un 400 dont le
  // message parle de schéma, pas au commerçant.
  it("refuse un mode de versement hors énumération, sans appeler trust-api", async () => {
    const state = await chooseFinancingAction(null, formulaire({ disbursementMethod: "especes_en_main" }));

    expect(state).toEqual({ error: expect.stringContaining("mode de versement"), conflit: false });
    expect(chooseFinancingMock).not.toHaveBeenCalled();
  });

  it("refuse un mode de versement absent", async () => {
    const state = await chooseFinancingAction(null, formulaire({ disbursementMethod: "" }));

    expect(state).toEqual({ error: expect.stringContaining("mode de versement"), conflit: false });
    expect(chooseFinancingMock).not.toHaveBeenCalled();
  });
});

describe("chooseFinancingAction — refus de trust-api", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton-pme");
  });

  // Le message de l'API distingue « non finançable », « partenaire introuvable
  // ou inactif » et « déjà financée » : le remplacer par un texte générique
  // perdrait la seule explication utile.
  it("relaie le message de refus tel quel", async () => {
    chooseFinancingMock.mockRejectedValue(new TrustApiError("Facture inv-1 non finançable", 409));

    const state = await chooseFinancingAction(null, formulaire());

    expect(state).toEqual({ error: "Facture inv-1 non finançable", conflit: true });
  });

  // Un 403 n'est pas un conflit : ce n'est pas « quelqu'un est passé avant »,
  // c'est « ce compte n'a pas ce droit ». Les confondre ferait basculer
  // l'écran sur une confirmation de cession qui n'a jamais eu lieu.
  it("ne marque pas un refus d'autorisation comme un conflit", async () => {
    chooseFinancingMock.mockRejectedValue(new TrustApiError("Accès refusé", 403));

    const state = await chooseFinancingAction(null, formulaire());

    expect(state).toEqual({ error: "Accès refusé", conflit: false });
  });

  it("ne laisse pas fuir une panne réseau brute vers l'écran", async () => {
    chooseFinancingMock.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:3000"));

    const state = await chooseFinancingAction(null, formulaire());

    expect(state).toEqual({ error: "Arbitrage temporairement indisponible", conflit: false });
  });

  it("ne rafraîchit rien quand la cession a échoué", async () => {
    chooseFinancingMock.mockRejectedValue(new TrustApiError("Facture inv-1 déjà financée", 409));

    await chooseFinancingAction(null, formulaire());

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// K5 — DOUBLE CLIC ULTRA-RAPIDE SUR LE RAIL A.
//
// Le pendant côté web du test de concurrence de financing.service.spec.ts. Ce
// qu'il éprouve n'est PAS le serveur (mocké ici) mais la Server Action : deux
// invocations lancées avant que la première n'ait rendu la main doivent aboutir
// à UNE cession et UN état de conflit lisible — jamais deux succès, jamais une
// exception non rattrapée qui remonterait en page d'erreur Next.
//
// Le faux serveur reproduit la sémantique de l'updateMany conditionnel : les
// deux requêtes entrent, une seule revendique la facture, la seconde repart
// avec un 409 et n'écrit aucun second événement d'audit.
// ─────────────────────────────────────────────────────────────────────────────
function serveurACessionUnique() {
  let cessionnaire: string | null = null;
  const journalWorm: { type: string; partnerId: string }[] = [];

  return {
    journalWorm,
    appel: async (_token: string, invoiceId: string, input: { financialPartnerId: string }) => {
      // Le tick asynchrone est l'aller-retour réseau : sans lui, la première
      // invocation irait jusqu'au bout avant que la seconde ne démarre, et le
      // test ne prouverait plus rien sur la concurrence.
      await Promise.resolve();
      if (cessionnaire !== null) {
        throw new TrustApiError(`Facture ${invoiceId} déjà financée`, 409);
      }
      cessionnaire = input.financialPartnerId;
      journalWorm.push({ type: "financing_disbursed", partnerId: input.financialPartnerId });
    },
  };
}

describe("chooseFinancingAction — idempotence concurrentielle (K5, ADR-089)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton-pme");
  });

  it("sur deux clics simultanés, une seule cession aboutit et l'autre rend un conflit propre", async () => {
    const serveur = serveurACessionUnique();
    chooseFinancingMock.mockImplementation(serveur.appel);

    const resultats = await Promise.all([
      chooseFinancingAction(null, formulaire()),
      chooseFinancingAction(null, formulaire()),
    ]);

    const succes = resultats.filter((state) => state !== null && "ok" in state);
    const conflits = resultats.filter((state) => state !== null && "error" in state && state.conflit);

    expect(succes).toHaveLength(1);
    expect(conflits).toHaveLength(1);
    // Aucune des deux invocations ne remonte une exception : les deux rendent
    // un état affichable. C'est ce qui empêche un double clic de dégénérer en
    // page d'erreur Next à la place de l'écran de facture.
    expect(resultats.every((state) => state !== null)).toBe(true);
  });

  it("n'inscrit qu'UN seul événement d'audit malgré les deux clics", async () => {
    const serveur = serveurACessionUnique();
    chooseFinancingMock.mockImplementation(serveur.appel);

    await Promise.all([
      chooseFinancingAction(null, formulaire()),
      chooseFinancingAction(null, formulaire()),
    ]);

    expect(serveur.journalWorm).toEqual([
      { type: "financing_disbursed", partnerId: "11111111-1111-4111-8111-111111111111" },
    ]);
  });

  // Le cas le plus dangereux : deux clics visant DEUX établissements distincts
  // (deux onglets ouverts, deux associés). Un seul rachat doit exister, et la
  // facture ne doit jamais porter deux cessionnaires.
  it("ne cède la créance qu'à un seul établissement quand deux sont visés en même temps", async () => {
    const serveur = serveurACessionUnique();
    chooseFinancingMock.mockImplementation(serveur.appel);

    await Promise.all([
      chooseFinancingAction(null, formulaire({ financialPartnerId: "22222222-2222-4222-8222-222222222222" })),
      chooseFinancingAction(null, formulaire({ financialPartnerId: "33333333-3333-4333-8333-333333333333" })),
    ]);

    expect(serveur.journalWorm).toHaveLength(1);
  });

  // Le second clic ne rafraîchit rien : seule la requête gagnante revalide. Un
  // revalidatePath sur l'échec ferait recharger l'écran et effacerait l'état de
  // conflit avant que le commerçant ne l'ait lu.
  it("ne revalide la page qu'une fois, pour la requête gagnante", async () => {
    const serveur = serveurACessionUnique();
    chooseFinancingMock.mockImplementation(serveur.appel);

    await Promise.all([
      chooseFinancingAction(null, formulaire()),
      chooseFinancingAction(null, formulaire()),
    ]);

    const detail = revalidatePathMock.mock.calls.filter(([chemin]) => chemin === "/dashboard/invoices/inv-1");
    expect(detail).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C15/C16, ADR-064 — convertToInvoiceAction(). Ce que ce couple d'actions
// distingue des quatre autres de ce fichier : elle ne réutilise PAS
// executer() (qui ne rend qu'un { ok } statique) parce que le composant
// client a besoin de l'identifiant de la NOUVELLE facture brouillon pour y
// rediriger côté client — jamais un redirect() serveur ici.
// ─────────────────────────────────────────────────────────────────────────────
describe("convertToInvoiceAction — conversion d'un devis/proforma en facture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionTokenMock.mockResolvedValue("jeton-pme");
  });

  function formulaireConversion(invoiceId = "devis-1"): FormData {
    const formData = new FormData();
    if (invoiceId) formData.set("invoiceId", invoiceId);
    return formData;
  }

  // Test D1
  it("refuse une conversion sans identifiant, sans appeler convertToInvoice", async () => {
    const state = await convertToInvoiceAction(null, formulaireConversion(""));

    expect(state).toEqual({ error: "Action impossible : identifiant de facture manquant" });
    expect(convertToInvoiceMock).not.toHaveBeenCalled();
  });

  // Test D2 — le message de trust-api distingue déjà « pas un devis/proforma »
  // et « déjà converti » : le relayer tel quel est ce qui fait qu'un 409 se lit
  // comme un fait acquis, pas comme une panne.
  it("relaie le message de TrustApiError tel quel sur échec", async () => {
    convertToInvoiceMock.mockRejectedValue(new TrustApiError("Proforma devis-1 ne peut être converti depuis le statut converted", 409));

    const state = await convertToInvoiceAction(null, formulaireConversion());

    expect(state).toEqual({ error: "Proforma devis-1 ne peut être converti depuis le statut converted" });
  });

  it("ne laisse pas fuir une panne réseau brute vers l'écran", async () => {
    convertToInvoiceMock.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:3000"));

    const state = await convertToInvoiceAction(null, formulaireConversion());

    expect(state).toEqual({ error: "Action temporairement indisponible" });
  });

  // Test D3
  it("retourne newInvoiceId sur succès et revalide les trois mêmes chemins que les autres actions", async () => {
    convertToInvoiceMock.mockResolvedValue({ id: "facture-2" });

    const state = await convertToInvoiceAction(null, formulaireConversion());

    expect(state).toEqual({ newInvoiceId: "facture-2" });
    expect(convertToInvoiceMock).toHaveBeenCalledWith("jeton-pme", "devis-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/invoices/devis-1");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/invoices");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("ne revalide rien quand la conversion a échoué", async () => {
    convertToInvoiceMock.mockRejectedValue(new TrustApiError("Déjà converti", 409));

    await convertToInvoiceAction(null, formulaireConversion());

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
