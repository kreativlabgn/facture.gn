"use client";

import { SiteHeader } from "@/components/SiteHeader";

// Se déclenche quand fetchInvoiceVerification() lève (trust-api en panne,
// 500, timeout réseau) — sans ce fichier, Next affiche son écran d'erreur
// générique non stylé, incohérent avec une page dont le but est d'inspirer
// confiance. reset() relance le rendu du segment sans recharger toute la page.
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[520px] flex-1 px-4 py-12 sm:px-6">
        <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
          <p className="font-display text-lg font-bold text-navy-950">Vérification temporairement indisponible</p>
          <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
            Le service de vérification ne répond pas pour le moment. Réessayez dans quelques instants.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-5 rounded-[10px] bg-navy-950 px-6 py-2.5 font-display text-sm font-semibold text-white transition hover:bg-navy-800"
          >
            Réessayer
          </button>
        </div>
      </main>
    </div>
  );
}
