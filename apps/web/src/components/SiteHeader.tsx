import Link from "next/link";

// Construction du wordmark verrouillée par la Charte v1.3 : Poppins 800,
// tracking -0.02em, lowercase exclusivement (R-03), dot #F2B705 entre
// "facture" et "gn" à la baseline — jamais un point "." littéral, le dot
// EST la ponctuation (déclinaison "Navy sur blanc · Digital", charte p.4).
export function SiteHeader() {
  return (
    <header className="border-b border-navy-100 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4 sm:px-6">
        <Link
          href="/"
          aria-label="facture.gn — Accueil"
          className="flex items-baseline font-display text-xl font-extrabold tracking-tight text-navy-950"
        >
          facture
          <span aria-hidden="true" className="mx-[2px] mb-[3px] inline-block h-[7px] w-[7px] rounded-full bg-yellow" />
          gn
        </Link>
        <p className="hidden text-sm text-navy-600 sm:block">Vérification publique</p>
      </div>
    </header>
  );
}
