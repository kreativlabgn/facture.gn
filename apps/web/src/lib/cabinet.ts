import {
  listAccessibleOrganizations,
  listOrganizationInvoicesForCabinet,
  listPracticeMembers,
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

export interface ClientSousMandat {
  mandat: AccessibleOrganizationMandate;
  /** Nombre de factures réellement émises — brouillons et annulées exclus. */
  facturesEmises: number;
  /** Somme des totaux TTC émis, en centimes GNF sérialisés. */
  volume: string;
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
        return { mandat, facturesEmises: 0, volume: "0", indisponible: true };
      }

      const emises = factures.filter((facture) => COMPTE_DANS_LE_VOLUME.has(facture.status));
      const volume = emises
        .reduce((somme, facture) => somme + BigInt(facture.totalTtc), BigInt(0))
        .toString();

      return { mandat, facturesEmises: emises.length, volume, indisponible: false };
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
