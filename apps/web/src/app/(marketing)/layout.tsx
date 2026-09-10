import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";

// Groupe de routes `(marketing)` : les parenthèses ne changent aucune URL — la
// landing reste `/`. Il isole le discours PUBLIC (celui qu'on tient à qui n'a
// pas encore de compte) du reste de l'application, et sort l'en-tête et le pied
// de page du corps de la landing, où ils occupaient un tiers du fichier.
//
// SiteHeader n'est pas réutilisable ici : il est taillé pour le tunnel `(auth)`
// (colonne étroite, mention « Vérification publique », aucune navigation). Cet
// en-tête-ci porte la navigation par segment et les deux portes d'entrée.
//
// Le NAV est défini ICI et non dans la page : l'en-tête et le pied de page le
// rendent tous les deux, et deux listes à maintenir en parallèle divergent
// toujours — c'est déjà ce qui était en train d'arriver dans l'ancien fichier.
// Les ancres pointent vers des sections que `page.tsx` doit poser ; une entrée
// ajoutée ici sans sa section donne un lien mort, silencieusement.
//
// QUATRE ESPACES, ET UN SEUL PAR PUBLIC. La page ne s'adresse pas « aux
// entreprises » : elle s'adresse à un commerçant de Madina, à un expert-
// comptable, à un DAF public et à un analyste crédit — quatre lecteurs qui ne
// cherchent pas la même preuve et n'ont pas le même vocabulaire. Chaque espace
// est ÉTANCHE : ce qui parle à l'un n'est pas répété chez l'autre, sinon la
// segmentation redevient une page unique découpée en intertitres.
const NAV = [
  { href: "#pme", label: "PME & marchands" },
  { href: "#cabinets", label: "Cabinets" },
  { href: "#grands-comptes", label: "Grands comptes" },
  { href: "#developpeurs", label: "Développeurs" },
  { href: "#verify", label: "Vérification" },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-grey text-navy-950">
      <header className="sticky top-0 z-50 border-b border-navy-100 bg-white">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            {/* Le logotype passe par Wordmark : bas de casse exclusif (R-03) et
                dot Or entre « facture » et « gn » (R-02) — le dot EST la
                ponctuation, jamais un point littéral ni une autre couleur. */}
            <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
            {/* La pastille cède la place à la navigation avant elle : à cinq
                espaces, c'est la barre de nav qui porte l'information utile.
                Elle revient à `xl`, où les deux tiennent sans se serrer. */}
            <span className="hidden rounded-full bg-navy-50 px-2.5 py-1 font-mono text-[11px] font-bold text-navy-600 xl:inline">
              LFI 2025
            </span>
          </div>

          <nav aria-label="Sections" className="hidden items-center gap-6 text-sm font-semibold text-navy-600 lg:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-navy-950">
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden text-sm font-semibold text-navy-950 hover:underline sm:inline">
              Se connecter
            </Link>
            {/* `primary` et non `accent` : l'unique accent Or de la page est le
                CTA du hero. Deux Or côte à côte et l'accent ne signale plus
                rien — c'est la règle « un par écran au plus » de la primitive. */}
            <ButtonLink href="/inscription" variant="primary">
              Créer un espace
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-navy-100 bg-white py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:px-6 md:flex-row lg:px-8">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
          <nav
            aria-label="Pied de page"
            className="flex flex-wrap items-center justify-center gap-6 text-sm text-navy-600"
          >
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition-colors hover:text-navy-950">
                {item.label}
              </a>
            ))}
            <Link href="/login" className="transition-colors hover:text-navy-950">
              Se connecter
            </Link>
          </nav>
          <p className="text-sm text-navy-600">Conakry, Guinée</p>
        </div>
      </footer>
    </div>
  );
}
