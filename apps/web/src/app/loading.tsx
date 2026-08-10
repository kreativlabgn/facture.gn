import { SiteHeader } from "@/components/SiteHeader";

// Le Server Component de [certificationId]/page.tsx attend le fetch vers
// trust-api avant de répondre — sans ce fichier, l'onglet reste blanc
// pendant l'aller-retour réseau (perceptible sur 3G). Squelette minimal,
// pas d'animation > 150ms (charte, ease-default).
export default function Loading() {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[520px] flex-1 px-4 py-12 sm:px-6">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <div className="h-[72px] w-[72px] rounded-full bg-navy-100" />
          <div className="h-5 w-48 rounded bg-navy-100" />
          <div className="mt-2 h-40 w-full rounded-2xl bg-navy-50" />
        </div>
      </main>
    </div>
  );
}
