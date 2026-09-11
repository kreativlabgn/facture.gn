import { beforeEach, describe, expect, it, vi } from "vitest";

// Chantier 3 — le checkout public Mobile Money (/pay/[invoiceId]).
//
// Trois propriétés y sont figées, parce que ce sont les trois qui coûtent de
// l'argent réel quand elles cèdent :
//   1. les frais sont ÉCLATÉS et le total est leur somme exacte ;
//   2. le net du marchand n'est JAMAIS amputé par ces frais ;
//   3. une facture réglée, annulée ou en litige ne peut pas être débitée — et
//      le refus tient côté serveur, pas seulement dans le DOM.
//
// L'éclatement se teste sans réseau (règle pure), le refus se teste sur la
// Server Action avec money-api simulé. Deux niveaux, pas un seul : un test qui
// monterait tout le rendu React pour vérifier une soustraction cacherait la
// règle derrière du JSX.

const jetonPaiementValideMock = vi.fn();
const fetchPublicCheckoutMock = vi.fn();
const chargeMobileMoneyMock = vi.fn();
const cookiesMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("@/lib/pay-session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pay-session")>("@/lib/pay-session");
  return {
    ...actual,
    jetonPaiementValide: (...args: unknown[]) => jetonPaiementValideMock(...args),
  };
});

vi.mock("@/lib/money-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/money-api")>("@/lib/money-api");
  return {
    ...actual,
    fetchPublicCheckout: (...args: unknown[]) => fetchPublicCheckoutMock(...args),
    chargeMobileMoney: (...args: unknown[]) => chargeMobileMoneyMock(...args),
  };
});

const { eclaterFrais } = await import("@/lib/checkout-fees");
const { normaliserMsisdn, formaterMsisdn } = await import("@/lib/mobile-money");
const { initiateMobileMoneyPaymentAction } = await import("./actions");
const { MoneyApiError } = await import("@/lib/money-api");

const INVOICE_ID = "3b3963da-d099-43ea-996b-80000060b28a";

// Une facture de 1 000 000 GNF (en centimes) au palier freemium : 2,1 % de
// commission facture.gn, puis 1,4 % de frais Djomy calculés sur le montant déjà
// majoré (effet de cascade documenté dans commission-grid.ts).
const CHECKOUT_PAYABLE = {
  provider: "djomy",
  paymentLinkUrl: "https://stub.djomy.africa/pay/djomy-ref",
  amountGnf: "102100000",
  feeGatewayGnf: "1429400",
  feePlatformGnf: "2100000",
  expiresAt: null,
  payable: true,
  motifRefus: null,
  messageRefus: null,
};

function formulaire(champs: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [cle, valeur] of Object.entries(champs)) {
    formData.set(cle, valeur);
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  cookiesMock.mockResolvedValue({ get: () => ({ value: "jeton-valide" }) });
  jetonPaiementValideMock.mockResolvedValue(true);
  fetchPublicCheckoutMock.mockResolvedValue(CHECKOUT_PAYABLE);
  chargeMobileMoneyMock.mockResolvedValue({
    providerRef: "djomy-stub-charge-ref",
    status: "pending",
    operator: "orange_money",
    instruction: "Composez #144#",
    totalDebiteGnf: "103529400",
  });
});

describe("Éclatement des frais (ADR-106)", () => {
  it("sépare marchandise, commission facture.gn et frais réseau en quatre montants distincts", () => {
    const frais = eclaterFrais(CHECKOUT_PAYABLE);

    expect(frais.marchandiseGnf).toBe(BigInt("100000000"));
    expect(frais.fraisPlateformeGnf).toBe(BigInt("2100000"));
    expect(frais.fraisGatewayGnf).toBe(BigInt("1429400"));
    expect(frais.totalGnf).toBe(BigInt("103529400"));
  });

  // Le payeur doit pouvoir refaire l'addition de tête. Si le total n'est pas
  // exactement la somme des trois lignes affichées, l'écran ment, quelle que
  // soit la justesse de chaque ligne prise isolément.
  it("rend un total qui est exactement la somme des trois lignes affichées", () => {
    const frais = eclaterFrais(CHECKOUT_PAYABLE);

    expect(frais.marchandiseGnf + frais.fraisPlateformeGnf + frais.fraisGatewayGnf).toBe(
      frais.totalGnf,
    );
  });

  // LA propriété du chantier : le marchand encaisse ce qu'il a facturé. Les
  // frais s'ajoutent au-dessus du prix, ils ne le rognent pas.
  it("laisse le net du marchand intact — les frais s'ajoutent, ils n'amputent jamais", () => {
    const frais = eclaterFrais(CHECKOUT_PAYABLE);

    expect(frais.marchandiseGnf).toBe(BigInt("100000000"));
    expect(frais.totalGnf).toBeGreaterThan(frais.marchandiseGnf);
  });

  // Même facture, frais gateway doublés : le marchand touche toujours autant,
  // c'est le payeur qui voit son total monter. Un barème qui bougerait ne doit
  // jamais se rattraper sur la marchandise.
  it("garde la marchandise constante quand les frais gateway augmentent", () => {
    const normal = eclaterFrais(CHECKOUT_PAYABLE);
    const fraisDoubles = eclaterFrais({ ...CHECKOUT_PAYABLE, feeGatewayGnf: "2858800" });

    expect(fraisDoubles.marchandiseGnf).toBe(normal.marchandiseGnf);
    expect(fraisDoubles.totalGnf - normal.totalGnf).toBe(BigInt("1429400"));
  });

  // Aucun littéral BigInt (`0n`) dans le code de production : le web cible
  // ES2017. Ce test ne le prouve pas à lui seul — c'est le typecheck qui le
  // fait — mais il vérifie que les montants restent des BigInt et ne sont
  // jamais retombés en Number, où les centimes GNF perdraient leur précision.
  it("manipule des BigInt et jamais des Number, jusque sur de très grands montants", () => {
    const enorme = eclaterFrais({
      amountGnf: "9007199254740993000",
      feeGatewayGnf: "1000",
      feePlatformGnf: "3000",
    });

    expect(typeof enorme.totalGnf).toBe("bigint");
    expect(enorme.marchandiseGnf).toBe(BigInt("9007199254740990000"));
  });
});

describe("Normalisation du numéro payeur", () => {
  it.each([
    ["622000000", "+224622000000"],
    ["622 00 00 00", "+224622000000"],
    ["+224 622 00 00 00", "+224622000000"],
    ["00224622000000", "+224622000000"],
    ["224622000000", "+224622000000"],
    ["+224-622-000-000", "+224622000000"],
  ])("ramène %s à la forme canonique %s", (brut, attendu) => {
    const resultat = normaliserMsisdn(brut);

    expect(resultat).toEqual({ ok: true, msisdn: attendu });
  });

  it.each([
    ["", "vide"],
    ["12345", "trop court"],
    ["722000000", "ne commence pas par 6"],
    ["+33612345678", "indicatif étranger"],
    ["622abc000", "contient des lettres"],
  ])("refuse %s (%s) avec un message lisible", (brut) => {
    const resultat = normaliserMsisdn(brut);

    expect(resultat.ok).toBe(false);
    if (!resultat.ok) {
      expect(resultat.erreur.length).toBeGreaterThan(0);
    }
  });

  it("réaffiche le numéro groupé, pour que le payeur relise ce qui sera débité", () => {
    expect(formaterMsisdn("+224622000000")).toBe("+224 622 00 00 00");
  });
});

describe("initiateMobileMoneyPaymentAction — blocages", () => {
  // Le cas nommé par le cahier des charges : facture sous litige actif.
  it("refuse le débit d'une facture en litige, sans jamais appeler le gateway", async () => {
    fetchPublicCheckoutMock.mockResolvedValue({
      ...CHECKOUT_PAYABLE,
      payable: false,
      motifRefus: "en_litige",
      messageRefus: "Cette facture fait l'objet d'une contestation en cours.",
    });

    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622000000", operator: "orange_money" }),
    );

    expect(etat).toEqual({
      statut: "erreur",
      message: "Cette facture fait l'objet d'une contestation en cours.",
    });
    expect(chargeMobileMoneyMock).not.toHaveBeenCalled();
  });

  it.each([
    ["deja_reglee", "Cette facture est déjà réglée."],
    ["annulee", "Cette facture a été annulée par le marchand."],
  ])("refuse le débit d'une facture %s", async (motifRefus, messageRefus) => {
    fetchPublicCheckoutMock.mockResolvedValue({
      ...CHECKOUT_PAYABLE,
      payable: false,
      motifRefus,
      messageRefus,
    });

    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622000000", operator: "orange_money" }),
    );

    expect(etat).toEqual({ statut: "erreur", message: messageRefus });
    expect(chargeMobileMoneyMock).not.toHaveBeenCalled();
  });

  // Le jeton est signé SUR l'invoiceId : viser une autre facture en modifiant
  // le champ caché invalide la signature. C'est ce qui empêche un cookie obtenu
  // sur une facture de servir à débiter pour une autre.
  it("refuse quand le jeton de session ne couvre pas cette facture", async () => {
    jetonPaiementValideMock.mockResolvedValue(false);

    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622000000", operator: "orange_money" }),
    );

    expect(etat).toMatchObject({ statut: "erreur" });
    expect(fetchPublicCheckoutMock).not.toHaveBeenCalled();
    expect(chargeMobileMoneyMock).not.toHaveBeenCalled();
  });

  it("refuse un numéro invalide avant tout appel réseau", async () => {
    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "722000000", operator: "orange_money" }),
    );

    expect(etat).toMatchObject({ statut: "erreur" });
    expect(chargeMobileMoneyMock).not.toHaveBeenCalled();
  });

  it("refuse un opérateur inconnu plutôt que de le transmettre au gateway", async () => {
    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622000000", operator: "bitcoin" }),
    );

    expect(etat).toMatchObject({ statut: "erreur" });
    expect(chargeMobileMoneyMock).not.toHaveBeenCalled();
  });

  it("refuse quand le lien de paiement n'existe plus", async () => {
    fetchPublicCheckoutMock.mockResolvedValue(null);

    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622000000", operator: "orange_money" }),
    );

    expect(etat).toMatchObject({ statut: "erreur" });
    expect(chargeMobileMoneyMock).not.toHaveBeenCalled();
  });
});

describe("initiateMobileMoneyPaymentAction — débit engagé", () => {
  it("transmet le numéro CANONIQUE au gateway, jamais la saisie brute", async () => {
    await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622 00 00 00", operator: "orange_money" }),
    );

    expect(chargeMobileMoneyMock).toHaveBeenCalledWith(INVOICE_ID, "+224622000000", "orange_money");
  });

  // Le débit est `pending` : l'écran doit dire « demande envoyée », jamais
  // « payé ». La facture ne passe à réglée qu'au retour du webhook.
  it("rend un état engagé qui porte l'instruction de l'opérateur, jamais un encaissement", async () => {
    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622000000", operator: "orange_money" }),
    );

    expect(etat).toEqual({
      statut: "engage",
      instruction: "Composez #144#",
      totalDebiteGnf: "103529400",
      msisdn: "+224622000000",
    });
  });

  // Le total débité annoncé par money-api doit être celui que la page a affiché.
  it("débite exactement le total qui avait été affiché au payeur", async () => {
    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622000000", operator: "orange_money" }),
    );

    const frais = eclaterFrais(CHECKOUT_PAYABLE);
    expect(etat).toMatchObject({ totalDebiteGnf: frais.totalGnf.toString() });
  });

  // Un refus de money-api (409 facture non payable, 503 provider indisponible)
  // porte déjà un message écrit pour le payeur : on le remonte tel quel plutôt
  // que d'en inventer un second qui dirait autre chose.
  it("remonte le message de refus de money-api sans le réécrire", async () => {
    chargeMobileMoneyMock.mockRejectedValue(
      new MoneyApiError("Un paiement est déjà en cours pour cette facture.", 409),
    );

    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622000000", operator: "orange_money" }),
    );

    expect(etat).toEqual({
      statut: "erreur",
      message: "Un paiement est déjà en cours pour cette facture.",
    });
  });

  it("ne laisse pas fuiter une panne technique inattendue vers l'écran du payeur", async () => {
    chargeMobileMoneyMock.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.4:3001"));

    const etat = await initiateMobileMoneyPaymentAction(
      null,
      formulaire({ invoiceId: INVOICE_ID, msisdn: "622000000", operator: "orange_money" }),
    );

    expect(etat).toMatchObject({ statut: "erreur" });
    if (etat && "message" in etat) {
      expect(etat.message).not.toContain("ECONNREFUSED");
    }
  });
});
