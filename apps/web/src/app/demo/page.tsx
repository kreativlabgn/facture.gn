import type { Metadata } from "next";
import { ComptesDemo } from "@/components/ComptesDemo";
import { Wordmark } from "@/components/Wordmark";

export const metadata: Metadata = {
  title: "Démonstration — facture.gn",
  robots: { index: false, follow: false },
};

// Point d'entrée des trois scénarios. Il existe pour une raison simple : une
// adresse qu'on donne à l'oral. « Va sur facture.gn/demo » se retient, se dicte
// au téléphone et s'écrit sur une carte — pas une URL profonde vers un tableau
// de bord.
//
// La page ne contient rien de plus que l'encadré déjà servi sur /inscription :
// une seconde liste de scénarios, maintenue en parallèle, divergerait au
// premier changement de chiffre.
export default function DemoIndexPage() {
  return (
    <div className="flex min-h-full flex-col bg-grey">
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-5xl items-center px-4 py-4 sm:px-6">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
        <ComptesDemo />
      </main>
    </div>
  );
}
