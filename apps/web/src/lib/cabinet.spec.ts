import { beforeEach, describe, expect, it, vi } from "vitest";

// lib/cabinet compose des vues que trust-api n'agrège nulle part : il n'existe
// ni /practices/dashboard, ni « volume supervisé » calculé serveur. Tout ce qui
// s'affiche sur la console du cabinet est donc recomposé ici, à partir de
// routes réelles — et c'est exactement ce que ces tests figent.
//
// Deux propriétés y comptent plus que les totaux eux-mêmes :
//   • un chiffre qu'on n'a pas pu lire ne vaut JAMAIS zéro. Zéro est une
//     affirmation ; « indisponible » est la vérité, et l'écran la relaie ;
//   • aucun littéral BigInt (`0n`) n'est possible — la cible TypeScript de
//     `web` est ES2017 (apps/web/tsconfig.json). Les montants circulent en
//     chaînes de centimes, comme partout ailleurs dans ce dépôt.

const listAccessibleOrganizationsMock = vi.fn();
const listOrganizationInvoicesForCabinetMock = vi.fn();
const listPracticeMembersMock = vi.fn();
const listPracticeRevenueShareMock = vi.fn();
const getPartnerSubscriptionStatusMock = vi.fn();

vi.mock("./trust-api", () => ({
  listAccessibleOrganizations: (...args: unknown[]) => listAccessibleOrganizationsMock(...args),
  listOrganizationInvoicesForCabinet: (...args: unknown[]) =>
    listOrganizationInvoicesForCabinetMock(...args),
  listPracticeMembers: (...args: unknown[]) => listPracticeMembersMock(...args),
  listPracticeRevenueShare: (...args: unknown[]) => listPracticeRevenueShareMock(...args),
  getPartnerSubscriptionStatus: (...args: unknown[]) => getPartnerSubscriptionStatusMock(...args),
}));

const { chargerConsoleCabinet, chargerPartageHonoraires, moisCourant } = await import("./cabinet");

function mandat(id: string, organizationId: string) {
  return {
    id,
    organizationId,
    organization: { id: organizationId, name: `Client ${organizationId}` },
    grantedRole: "accountant_external",
    grantedAt: "2026-01-15T00:00:00.000Z",
  };
}

function facture(status: string, totalTtc: string) {
  return { id: `f-${status}-${totalTtc}`, number: null, status, totalTtc, certificationId: null, createdAt: "2026-09-01T00:00:00.000Z" };
}

function credit(fields: {
  organizationId: string;
  periodMonth: string;
  creditedAmountCentimes: string;
  status?: string;
}) {
  return {
    id: `c-${fields.organizationId}-${fields.periodMonth}`,
    organizationId: fields.organizationId,
    periodMonth: fields.periodMonth,
    grossCommissionCentimes: fields.creditedAmountCentimes,
    creditedAmountCentimes: fields.creditedAmountCentimes,
    status: fields.status ?? "pending",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listPracticeMembersMock.mockResolvedValue([]);
});

describe("moisCourant — la période, en UTC", () => {
  // Même dérivation que currentPeriodMonth() dans revenue-share.controller.ts.
  // Un décalage d'un mois entre l'écran et le serveur ferait afficher « acquis
  // ce mois : 0 » le 1er du mois à un cabinet qui a bien été crédité.
  it("rend YYYY-MM zéro-paddé", () => {
    expect(moisCourant(new Date("2026-09-08T10:00:00.000Z"))).toBe("2026-09");
    expect(moisCourant(new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-01");
    expect(moisCourant(new Date("2026-12-31T23:59:59.000Z"))).toBe("2026-12");
  });

  // Le fuseau de la Guinée est UTC+0, mais le serveur de rendu peut être
  // ailleurs : c'est l'heure UTC qui tranche, jamais l'heure locale du process.
  it("suit UTC et non le fuseau local", () => {
    expect(moisCourant(new Date("2026-02-28T23:30:00.000Z"))).toBe("2026-02");
    expect(moisCourant(new Date("2026-03-01T00:30:00.000Z"))).toBe("2026-03");
  });
});

describe("chargerConsoleCabinet — encaissé et encours", () => {
  it("sépare ce qui est soldé de ce qui reste dû", async () => {
    listAccessibleOrganizationsMock.mockResolvedValue([mandat("m-1", "org-1")]);
    listOrganizationInvoicesForCabinetMock.mockResolvedValue([
      facture("paid", "500000"),
      facture("issued", "300000"),
      // Comptée ENTIÈRE dans l'encours : GET /invoices ne rend pas la part déjà
      // réglée. L'encours est un majorant, et l'écran le dit.
      facture("partially_paid", "200000"),
      // Ni l'un ni l'autre : un brouillon n'a jamais été émis, une facture
      // annulée ne représente plus rien.
      facture("draft", "999900"),
      facture("void", "888800"),
    ]);

    const { clients, volumeTotal, facturesTotal } = await chargerConsoleCabinet("tok", "prat-1");

    expect(clients).toHaveLength(1);
    expect(clients[0].encaisse).toBe("500000");
    expect(clients[0].encours).toBe("500000");
    expect(clients[0].volume).toBe("1000000");
    expect(clients[0].facturesEmises).toBe(3);
    expect(volumeTotal).toBe("1000000");
    expect(facturesTotal).toBe(3);
  });

  // Zéro serait un mensonge : la lecture a échoué, on ne sait pas. C'est le
  // drapeau `indisponible` qui porte l'information, pas un total à 0.
  it("marque le client dont les factures n'ont pas pu être lues", async () => {
    listAccessibleOrganizationsMock.mockResolvedValue([mandat("m-1", "org-1"), mandat("m-2", "org-2")]);
    listOrganizationInvoicesForCabinetMock
      .mockResolvedValueOnce([facture("paid", "700000")])
      .mockRejectedValueOnce(new Error("503"));

    const { clients, totauxPartiels, volumeTotal } = await chargerConsoleCabinet("tok", "prat-1");

    expect(clients[1].indisponible).toBe(true);
    expect(clients[1].encaisse).toBe("0");
    expect(clients[1].encours).toBe("0");
    expect(totauxPartiels).toBe(true);
    // Le total ne compte que ce qui a été réellement lu.
    expect(volumeTotal).toBe("700000");
  });

  // Les montants dépassent Number.MAX_SAFE_INTEGER dès qu'on additionne des
  // centimes GNF sur un portefeuille entier : le calcul doit rester en BigInt
  // de bout en bout, sans jamais passer par un Number.
  it("additionne sans perdre de précision au-delà de 2^53", async () => {
    listAccessibleOrganizationsMock.mockResolvedValue([mandat("m-1", "org-1")]);
    listOrganizationInvoicesForCabinetMock.mockResolvedValue([
      facture("paid", "9007199254740993"),
      facture("paid", "1"),
    ]);

    const { clients } = await chargerConsoleCabinet("tok", "prat-1");

    expect(clients[0].encaisse).toBe("9007199254740994");
  });
});

describe("chargerPartageHonoraires — la commission d'apporteur", () => {
  it("ne compte que la période demandée, et compte les entreprises", async () => {
    listPracticeRevenueShareMock.mockResolvedValue([
      credit({ organizationId: "org-1", periodMonth: "2026-09", creditedAmountCentimes: "500000" }),
      credit({ organizationId: "org-2", periodMonth: "2026-09", creditedAmountCentimes: "250000" }),
      credit({ organizationId: "org-1", periodMonth: "2026-08", creditedAmountCentimes: "500000" }),
    ]);
    getPartnerSubscriptionStatusMock.mockResolvedValue({
      practiceId: "prat-1",
      periodMonth: "2026-09",
      tier: "partner_starter",
      amountDueCentimes: "1250000",
    });

    const partage = await chargerPartageHonoraires("tok", "prat-1", "2026-09");

    expect(partage.crediteCeMois).toBe("750000");
    expect(partage.clientsRemunerateurs).toBe(2);
    // « En attente » traverse les périodes : c'est ce qui n'a pas été reversé,
    // pas ce qui a été acquis ce mois-ci.
    expect(partage.enAttente).toBe("1250000");
    expect(partage.abonnementRestantDu).toBe("1250000");
    expect(partage.indisponible).toBe(false);
  });

  it("exclut du reste à reverser ce qui a déjà été payé", async () => {
    listPracticeRevenueShareMock.mockResolvedValue([
      credit({ organizationId: "org-1", periodMonth: "2026-09", creditedAmountCentimes: "400000", status: "paid" }),
      credit({ organizationId: "org-2", periodMonth: "2026-09", creditedAmountCentimes: "100000", status: "pending" }),
    ]);
    getPartnerSubscriptionStatusMock.mockResolvedValue({
      practiceId: "prat-1",
      periodMonth: "2026-09",
      tier: "partner_free",
      amountDueCentimes: "0",
    });

    const partage = await chargerPartageHonoraires("tok", "prat-1", "2026-09");

    // Acquis sur la période : les deux. En attente de reversement : le pending.
    expect(partage.crediteCeMois).toBe("500000");
    expect(partage.enAttente).toBe("100000");
  });

  // `null` = palier sur devis (institutionnel). Ce n'est PAS zéro : « rien à
  // payer » et « prix négocié hors grille » ne se disent pas de la même façon.
  it("distingue le palier sur devis d'un solde nul", async () => {
    listPracticeRevenueShareMock.mockResolvedValue([]);
    getPartnerSubscriptionStatusMock.mockResolvedValue({
      practiceId: "prat-1",
      periodMonth: "2026-09",
      tier: "partner_institutional",
      amountDueCentimes: null,
    });

    const partage = await chargerPartageHonoraires("tok", "prat-1", "2026-09");

    expect(partage.abonnementRestantDu).toBeNull();
    expect(partage.indisponible).toBe(false);
    expect(partage.crediteCeMois).toBe("0");
  });

  // L'abonnement est un appel séparé : son échec ne doit pas effacer les
  // crédits, qui sont la donnée principale du panneau.
  it("garde les crédits quand seul l'abonnement échoue", async () => {
    listPracticeRevenueShareMock.mockResolvedValue([
      credit({ organizationId: "org-1", periodMonth: "2026-09", creditedAmountCentimes: "300000" }),
    ]);
    getPartnerSubscriptionStatusMock.mockRejectedValue(new Error("503"));

    const partage = await chargerPartageHonoraires("tok", "prat-1", "2026-09");

    expect(partage.crediteCeMois).toBe("300000");
    expect(partage.abonnementRestantDu).toBeNull();
    expect(partage.indisponible).toBe(true);
  });

  // Si les crédits eux-mêmes manquent, il ne reste rien de vrai à afficher :
  // tout retombe à zéro AVEC le drapeau, et l'écran remplace les chiffres par
  // une phrase plutôt que de montrer un partage d'honoraires nul.
  it("ne montre aucun chiffre quand les crédits n'ont pas pu être lus", async () => {
    listPracticeRevenueShareMock.mockRejectedValue(new Error("503"));
    getPartnerSubscriptionStatusMock.mockResolvedValue({
      practiceId: "prat-1",
      periodMonth: "2026-09",
      tier: "partner_pro",
      amountDueCentimes: "5000000",
    });

    const partage = await chargerPartageHonoraires("tok", "prat-1", "2026-09");

    expect(partage.indisponible).toBe(true);
    expect(partage.crediteCeMois).toBe("0");
    expect(partage.enAttente).toBe("0");
    expect(partage.clientsRemunerateurs).toBe(0);
    expect(partage.abonnementRestantDu).toBeNull();
  });
});
