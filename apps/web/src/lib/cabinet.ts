import {
  getPartnerSubscriptionStatus,
  listAccessibleOrganizations,
  listOrganizationInvoicesForCabinet,
  listPracticeMembers,
  listPracticeRevenueShare,
  type AccessibleOrganizationMandate,
  type InvoiceListItem,
  type PracticeMemberItem,
} from "./trust-api";

// Console du cabinet : la vue consolidée de ses clients sous mandat.
//
// IL N'EXISTE AUCUN ENDPOINT D'AGRÉGATION. Pas de /practices/dashboard, pas de
// « volume supervisé » calculé côté serveur. Ce module compose donc la vue à
// partir de trois routes réelles : les mandats actifs, les collaborateurs, et
// les factures de CHAQUE organisation cliente (cabinet-view).
//
// Le coût est assumé et visible ici plutôt que caché : une requête par client.
// C'est tenable pour un cabinet qui suit quelques dizaines de PME, et ça
// évite d'afficher un chiffre inventé. Le jour où un cabinet en suit des
// centaines, c'est une route d'agrégation qu'il faudra — pas une astuce ici.

// Statuts qui comptent dans le volume : un brouillon n'a jamais été émis, une
// facture annulée ne représente plus rien. Même exclusion que le portail
// acheteur et le FEC.
const COMPTE_DANS_LE_VOLUME = new Set(["issued", "partially_paid", "paid"]);

// Ce qui n'est pas encore soldé. `partially_paid` y est ENTIER, et c'est une
// approximation assumée : GET /invoices ne rend que `totalTtc` et `status`
// (InvoiceListItem), jamais la part déjà réglée. Une facture à moitié payée
// pèse donc ici pour son montant plein — l'encours est un MAJORANT, jamais un
// solde exact, et le libellé à l'écran le dit. L'alternative — ouvrir chaque
// facture pour lire ses paiements — coûterait une requête par facture et par
// client, sur un écran qui en charge déjà une par client.
const RESTE_A_ENCAISSER = new Set(["issued", "partially_paid"]);

export interface ClientSousMandat {
  mandat: AccessibleOrganizationMandate;
  /** Nombre de factures réellement émises — brouillons et annulées exclus. */
  facturesEmises: number;
  /** Somme des totaux TTC émis, en centimes GNF sérialisés. */
  volume: string;
  /** Somme des factures soldées (`paid`), en centimes GNF sérialisés. */
  encaisse: string;
  /** Majorant de ce qui reste à encaisser — voir RESTE_A_ENCAISSER. */
  encours: string;
  /** true quand la liste de factures de ce client n'a pas pu être chargée :
   *  les compteurs valent alors 0 sans que ce soit la réalité. */
  indisponible: boolean;
}

export interface ConsoleCabinet {
  clients: ClientSousMandat[];
  equipe: PracticeMemberItem[];
  /** Volume consolidé de tous les clients, en centimes GNF sérialisés. */
  volumeTotal: string;
  facturesTotal: number;
  /** true si au moins un client n'a pas pu être chargé — les totaux sont
   *  alors incomplets, et l'écran doit le dire plutôt que de laisser croire. */
  totauxPartiels: boolean;
}

export async function chargerConsoleCabinet(
  token: string,
  practiceId: string,
): Promise<ConsoleCabinet> {
  const [mandats, equipe] = await Promise.all([
    listAccessibleOrganizations(token, practiceId),
    // L'équipe est un panneau secondaire : son échec ne doit pas emporter la
    // liste des clients, qui est la raison d'être de l'écran.
    listPracticeMembers(token, practiceId).catch(() => [] as PracticeMemberItem[]),
  ]);

  const clients = await Promise.all(
    mandats.map(async (mandat) => {
      let factures: InvoiceListItem[] | null = null;
      try {
        factures = await listOrganizationInvoicesForCabinet(token, mandat.organizationId);
      } catch {
        factures = null;
      }

      if (factures === null) {
        return {
          mandat,
          facturesEmises: 0,
          volume: "0",
          encaisse: "0",
          encours: "0",
          indisponible: true,
        };
      }

      // BigInt(0) et jamais le littéral `0n` : la cible TypeScript de `web` est
      // ES2017 (apps/web/tsconfig.json), sous laquelle un littéral BigInt ne
      // compile pas.
      const totalDe = (liste: readonly InvoiceListItem[]): string =>
        liste.reduce((somme, facture) => somme + BigInt(facture.totalTtc), BigInt(0)).toString();

      const emises = factures.filter((facture) => COMPTE_DANS_LE_VOLUME.has(facture.status));

      return {
        mandat,
        facturesEmises: emises.length,
        volume: totalDe(emises),
        encaisse: totalDe(factures.filter((facture) => facture.status === "paid")),
        encours: totalDe(factures.filter((facture) => RESTE_A_ENCAISSER.has(facture.status))),
        indisponible: false,
      };
    }),
  );

  const volumeTotal = clients
    .reduce((somme, client) => somme + BigInt(client.volume), BigInt(0))
    .toString();

  return {
    clients,
    equipe,
    volumeTotal,
    facturesTotal: clients.reduce((somme, client) => somme + client.facturesEmises, 0),
    totauxPartiels: clients.some((client) => client.indisponible),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTAGE D'HONORAIRES (revenue share, H4/H3, ADR-071).
//
// Ce que le cabinet touche en amenant ses clients sur la plateforme : 10 % de
// la commission déjà perçue par facture.gn, plafonnés à 5 000 GNF par mois et
// par entreprise. Le calcul, le plafond et le stockage existaient côté
// trust-api ; aucun écran ne les lisait. Un partenaire ne pouvait donc pas
// savoir ce qui lui revenait — sur une offre dont c'est l'argument, c'est le
// chiffre qui manquait.
//
// Deux lectures distinctes, et il faut les deux pour dire quelque chose de
// juste : les CRÉDITS acquis (ce qui a été gagné) et le RESTE DÛ de
// l'abonnement (ce qui sera prélevé). En mode `subscription_deduction` le
// second est déjà net du premier — les afficher séparément sans le dire
// laisserait croire à un double compte.
// ─────────────────────────────────────────────────────────────────────────────

export interface PartageHonoraires {
  /** Format "YYYY-MM", en UTC — même convention que le contrôleur. */
  periodMonth: string;
  /** Crédits acquis sur la période, en centimes GNF sérialisés. */
  crediteCeMois: string;
  /** Crédits encore en attente de reversement, TOUTES périodes confondues. */
  enAttente: string;
  /** Nombre d'entreprises ayant généré un crédit sur la période. */
  clientsRemunerateurs: number;
  /** Reste dû de l'abonnement Partner pour la période. `null` = palier sur
   *  devis (institutionnel), ce qui n'est pas la même chose que zéro. */
  abonnementRestantDu: string | null;
  /** true si l'une des deux lectures a échoué : les montants ci-dessus valent
   *  alors "0" sans que ce soit la réalité, et l'écran doit le dire plutôt que
   *  d'afficher un chiffre faux. */
  indisponible: boolean;
}

/** Le mois courant en UTC — même dérivation que currentPeriodMonth() dans
 *  revenue-share.controller.ts. Le fuseau de la Guinée est UTC+0 : aucune
 *  divergence de bord de mois entre le serveur et l'écran. */
export function moisCourant(maintenant: Date = new Date()): string {
  return `${maintenant.getUTCFullYear()}-${String(maintenant.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function chargerPartageHonoraires(
  token: string,
  practiceId: string,
  periodMonth: string = moisCourant(),
): Promise<PartageHonoraires> {
  // allSettled et non Promise.all : le reste dû de l'abonnement est un appel
  // séparé, et son échec ne doit pas effacer les crédits, qui sont la donnée
  // principale de ce panneau.
  const [credits, abonnement] = await Promise.allSettled([
    listPracticeRevenueShare(token, practiceId),
    getPartnerSubscriptionStatus(token, practiceId, periodMonth),
  ]);

  if (credits.status !== "fulfilled") {
    return {
      periodMonth,
      crediteCeMois: "0",
      enAttente: "0",
      clientsRemunerateurs: 0,
      abonnementRestantDu: null,
      indisponible: true,
    };
  }

  const duMois = credits.value.filter((credit) => credit.periodMonth === periodMonth);

  // BigInt(0) et jamais le littéral `0n` : la cible TypeScript de `web` est
  // ES2017 (apps/web/tsconfig.json), sous laquelle un littéral BigInt ne
  // compile pas. Même discipline que chargerConsoleCabinet ci-dessus.
  const somme = (liste: readonly { creditedAmountCentimes: string }[]): string =>
    liste.reduce((total, credit) => total + BigInt(credit.creditedAmountCentimes), BigInt(0)).toString();

  return {
    periodMonth,
    crediteCeMois: somme(duMois),
    enAttente: somme(credits.value.filter((credit) => credit.status === "pending")),
    // Un même client peut apparaître une fois par période : sur UNE période, le
    // Set ne dédoublonne rien en pratique — il dit surtout que le compte est
    // celui des entreprises, jamais celui des lignes.
    clientsRemunerateurs: new Set(duMois.map((credit) => credit.organizationId)).size,
    abonnementRestantDu:
      abonnement.status === "fulfilled" ? abonnement.value.amountDueCentimes : null,
    indisponible: abonnement.status !== "fulfilled",
  };
}
