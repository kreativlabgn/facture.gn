// totalTtc arrive en centimes GNF, sérialisé en string (BigInt côté trust-api,
// voir main.ts:BigInt.prototype.toJSON — jamais un number pour ne pas perdre
// de précision au-delà de Number.MAX_SAFE_INTEGER). 100 centimes = 1 GNF (DAT).
export function formatGnf(centimesString: string): string {
  const centimes = BigInt(centimesString);
  const gnf = centimes / BigInt(100);
  return `${gnf.toLocaleString("fr-FR")} GNF`;
}

export function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ── ADR-108 — unité d'affichage des lignes de facture ────────────────────────
//
// Deux canaux écrivent dans invoice_line, et pas dans la même unité : le
// parcours marchand y met des prix unitaires TTC, la passerelle PDP des prix
// HORS TAXES déclarés par un ERP tiers. Sans cette lecture, l'écran intitule
// « TTC » des montants qui peuvent être HT.
//
// UNE SEULE UNITÉ PAR TABLEAU, là où la colonne est portée par la LIGNE : un
// en-tête ne peut en annoncer qu'une. En pratique les lignes d'une facture
// viennent toutes du même canal (un seul service les écrit, en une seule
// transaction). On ne le suppose pas pour autant : si elles divergeaient,
// intituler tout le tableau d'après la première mentirait sur les autres — on
// rend alors une chaîne VIDE, qui n'affirme rien de faux.
//
// Une ligne sans `saisieRegime` vient d'une facture sérialisée avant l'ADR-108 :
// elle suit la convention historique, qui était TTC.
export function uniteDeSaisie(lignes: { saisieRegime?: "TTC_FIRST" | "HT_FIRST" }[]): string {
  if (lignes.length === 0) {
    return " TTC";
  }
  const premier = lignes[0].saisieRegime ?? "TTC_FIRST";
  const homogene = lignes.every((ligne) => (ligne.saisieRegime ?? "TTC_FIRST") === premier);
  if (!homogene) {
    return "";
  }
  return premier === "HT_FIRST" ? " HT" : " TTC";
}
