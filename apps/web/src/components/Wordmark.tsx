import Link from "next/link";

// Construction verrouillée par la Charte v1.3 : Poppins 800, tracking
// -0.02em, lowercase exclusivement (R-03), dot #F2B705 entre "facture" et
// "gn" à la baseline — jamais un point "." littéral, le dot EST la
// ponctuation (déclinaison "Navy sur blanc · Digital", charte p.4). Extrait
// après une 3e occurrence identique (SiteHeader, dashboard/layout,
// cabinet/layout) — règle des trois atteinte.
export function Wordmark({ href, ariaLabel }: { href: string; ariaLabel: string }) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="flex items-baseline font-display text-xl font-extrabold tracking-tight text-navy-950"
    >
      facture
      <span aria-hidden="true" className="mx-[2px] mb-[3px] inline-block h-[7px] w-[7px] rounded-full bg-yellow" />
      gn
    </Link>
  );
}
