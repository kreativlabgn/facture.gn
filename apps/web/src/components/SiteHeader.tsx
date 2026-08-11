import { Wordmark } from "./Wordmark";

export function SiteHeader() {
  return (
    <header className="border-b border-navy-100 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4 sm:px-6">
        <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
        <p className="hidden text-sm text-navy-600 sm:block">Vérification publique</p>
      </div>
    </header>
  );
}
