// ── Éclatement des frais du checkout public (ADR-106) ───────────────────────
//
// Le payeur doit pouvoir vérifier lui-même que le total est la somme de ce qu'on
// lui montre. Trois lignes, un total, et aucune des quatre n'est arrondie ou
// recomposée ici : tout est relu de la tentative de paiement persistée.
//
// LA RÈGLE QUI NE PLIE PAS : la marchandise est ce que le marchand reçoit, et
// rien ne l'ampute. La commission facture.gn comme les frais du gateway
// s'AJOUTENT par-dessus — c'est pourquoi le total dépasse la marchandise au
// lieu que la marchandise soit rognée. Un jour où un barème changerait, c'est
// cette propriété-là qui doit tenir.
//
// `amountGnf` transporté par money-api porte DÉJÀ la commission facture.gn
// (InvoicesService.issue() envoie `totalTtc + platformFee`) : la marchandise
// s'obtient donc par soustraction, jamais par addition.

export interface FraisEclates {
  /** Net du marchand — le prix facturé, intact. */
  marchandiseGnf: bigint;
  /** Commission facture.gn, selon le palier commercial de l'émetteur. */
  fraisPlateformeGnf: bigint;
  /** Frais du réseau Mobile Money (1,4 % chez Djomy, ADR-106). */
  fraisGatewayGnf: bigint;
  /** Ce que le payeur débourse réellement. */
  totalGnf: bigint;
}

// Entrées en chaînes : les BigInt traversent l'API sérialisés en string
// (BigInt.prototype.toJSON côté Nest), jamais en number — un montant en
// centimes GNF dépasse Number.MAX_SAFE_INTEGER bien avant d'être exotique.
export function eclaterFrais(checkout: {
  amountGnf: string;
  feeGatewayGnf: string;
  feePlatformGnf: string;
}): FraisEclates {
  // BigInt(...) et non les littéraux `0n` / `100n` : le tsconfig du web cible
  // ES2017, où les littéraux BigInt ne compilent pas (même contrainte que
  // formatGnf et l'encours du portail acheteur).
  const montantPorte = BigInt(checkout.amountGnf);
  const fraisPlateformeGnf = BigInt(checkout.feePlatformGnf);
  const fraisGatewayGnf = BigInt(checkout.feeGatewayGnf);

  return {
    marchandiseGnf: montantPorte - fraisPlateformeGnf,
    fraisPlateformeGnf,
    fraisGatewayGnf,
    totalGnf: montantPorte + fraisGatewayGnf,
  };
}
