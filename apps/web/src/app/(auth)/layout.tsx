import { SiteHeader } from "@/components/SiteHeader";

// Groupe de routes `(auth)` : les parenthèses ne changent aucune URL. Il porte
// les écrans du tunnel qui suivent la création du compte — hub /inscription,
// /onboarding (organisation), /nouveau-cabinet (structure) — sous le
// SiteHeader public.
//
// /login, /register et /portail/auth n'en font PAS partie : ce sont les
// écrans d'ENTRÉE, rendus par AuthLayout (components/auth) en page entière —
// écran scindé, zone d'information par profil, sorties « changer de profil ».
// /register vit dans le groupe `(entree)` pour échapper à ce layout-ci sans
// changer d'URL.
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
