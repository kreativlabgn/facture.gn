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
