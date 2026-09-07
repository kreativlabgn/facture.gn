import {
  listPortalInvoices,
  listPortalOrganizations,
  type InvoiceListItem,
  type PortalOrganizationSummary,
} from "./trust-api";

// Chargement partagé du portail acheteur.
//
// IL N'EXISTE AUCUNE ROUTE « toutes mes factures ». trust-api expose la liste
// PAR CLIENT (GET /client-portal/customers/:customerId/invoices) parce qu'un
// même acheteur a une fiche distincte chez chaque entreprise qui le facture.
// Rassembler les factures est donc un travail du client : on lit les comptes,
// puis une liste par compte. Ce module le fait à un seul endroit, pour que
// l'accueil, la liste et le détail ne recodent pas trois fois la même boucle.

// Assez large pour couvrir l'historique d'un acheteur ordinaire sans
// pagination — le portail n'en propose pas encore — tout en restant sous le
// MAX_LIST_PAGE_SIZE de trust-api, qui plafonne de toute façon.
export const TAILLE_LISTE = 100;

/** Une facture et le compte qui la porte : la facture seule ne dit pas qui l'a émise. */
export interface LigneFacture {
  compte: PortalOrganizationSummary;
  facture: InvoiceListItem;
}

export interface DonneesPortail {
  comptes: PortalOrganizationSummary[];
  lignes: LigneFacture[];
  /** Somme des encours, en centimes GNF sérialisés — jamais un number. */
  totalDu: string;
}

export async function chargerPortail(token: string): Promise<DonneesPortail> {
  const comptes = await listPortalOrganizations(token);

  // En parallèle : un acheteur a rarement plus d'une poignée de fournisseurs,
  // et les enchaîner ajouterait un aller-retour par compte sur une connexion
  // mobile déjà lente.
  const parCompte = await Promise.all(
    comptes.map(async (compte) => ({
      compte,
      // Un compte en échec ne doit pas vider tout l'écran : on rend une liste
      // vide pour celui-là et on affiche les autres.
      factures: await listPortalInvoices(token, compte.customerId, { take: TAILLE_LISTE }).catch(
        () => [] as InvoiceListItem[],
      ),
    })),
  );

  const lignes = parCompte
    .flatMap(({ compte, factures }) => factures.map((facture) => ({ compte, facture })))
    // Antéchronologique toutes entreprises confondues : chaque liste arrive
    // déjà triée, mais leur concaténation ne l'est plus.
    .sort((a, b) => b.facture.createdAt.localeCompare(a.facture.createdAt));

  const totalDu = comptes
    .reduce((somme, compte) => somme + BigInt(compte.runningBalance), BigInt(0))
    .toString();

  return { comptes, lignes, totalDu };
}

/** Statuts qui pèsent encore sur l'acheteur — le reste est de l'historique. */
const A_REGLER = new Set(["issued", "partially_paid"]);

export function resteARegler(lignes: readonly LigneFacture[]): LigneFacture[] {
  return lignes.filter((ligne) => A_REGLER.has(ligne.facture.status));
}
