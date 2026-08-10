import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="border-b border-ink-100 bg-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-bold text-ink-950">
          facture<span className="text-trust-600">.gn</span>
        </Link>
        <p className="hidden text-sm text-ink-500 sm:block">Vérification publique</p>
      </div>
    </header>
  );
}
