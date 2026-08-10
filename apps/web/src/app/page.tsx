import { SiteHeader } from "@/components/SiteHeader";
import { CertificationLookupForm } from "@/components/CertificationLookupForm";

export default function HomePage() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-8 px-4 py-16 text-center sm:px-6">
        <div>
          <h1 className="font-display text-3xl font-bold text-navy-950 sm:text-4xl">
            Vérifier une facture certifiée
          </h1>
          <p className="mx-auto mt-3 max-w-md text-navy-600">
            Entrez l&apos;identifiant de vérification imprimé sur la facture pour confirmer son
            authenticité.
          </p>
        </div>
        <div className="w-full max-w-md">
          <CertificationLookupForm />
        </div>
      </main>
    </div>
  );
}
