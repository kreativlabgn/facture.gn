import { SiteHeader } from "@/components/SiteHeader";

// Groupe de routes `(auth)` : les parenthèses ne changent aucune URL —
// /register reste /register. Il ne porte que le tunnel d'entrée (inscription
// puis configuration de la PME).
//
// /login reste volontairement hors du groupe : il rend déjà son propre
// SiteHeader et vit dans une PR en cours. L'y déplacer ne changerait pas son
// URL mais créerait un conflit pour rien.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        {children}
      </main>
    </div>
  );
}
