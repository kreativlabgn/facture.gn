import Link from "next/link";

// Construction verrouillée par la charte + maquette consolidée : Space Grotesk
// 700 (poids max de la police), tracking serré, lowercase exclusivement (R-03),
// dot Or de Guinée #FBB500 (R-02 — jamais blanc/noir/autre) entre "facture" et
// "gn" à la baseline — jamais un point "." littéral, le dot EST la ponctuation.
// Extrait après une 3e occurrence identique (SiteHeader, dashboard/layout,
// cabinet/layout) — règle des trois atteinte.
export function Wordmark({ href, ariaLabel }: { href: string; ariaLabel: string }) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="flex items-baseline font-display text-xl font-bold tracking-tight text-navy-950"
    >
      facture
      <span aria-hidden="true" className="mx-[2px] mb-[3px] inline-block h-[7px] w-[7px] rounded-full bg-or" />
      gn
    </Link>
  );
}
