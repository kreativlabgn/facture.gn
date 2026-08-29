// Restitution HUMAINE d'un montant stocké en centimes GNF (100 centimes = 1 GNF,
// DAT / ADR-014). À ne pas confondre avec fec-formatting.ts::formatFecAmount,
// qui produit le format MACHINE de l'export légal FEC ("1250000.00", point
// décimal, sans séparateur ni libellé de devise).
//
// Convention d'affichage : séparateur de milliers = espace insécable U+00A0
// (évite un retour à la ligne au milieu d'un montant dans le PDF), décimale =
// virgule (usage francophone). Les décimales ne sont montrées que si le centime
// n'est pas rond — le GNF n'a pas de subdivision en circulation, mais une
// division entière (computeTaxBreakdown) peut laisser une fraction sur
// totalHt/totalTva.
const THIN_GROUP_SEPARATOR = " ";

export function formatGnf(centimes: bigint): string {
  const negative = centimes < 0n;
  const abs = negative ? -centimes : centimes;

  const whole = abs / 100n;
  const fraction = abs % 100n;

  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN_GROUP_SEPARATOR);
  const body = fraction === 0n
    ? groupedWhole
    : `${groupedWhole},${fraction.toString().padStart(2, "0")}`;

  return `${negative ? "-" : ""}${body} GNF`;
}
