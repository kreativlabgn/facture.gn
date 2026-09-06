import { Card } from "@/components/ui";

export interface Kpi {
  label: string;
  value: string;
  // Portée du chiffre, affichée sous la valeur. OBLIGATOIRE quand le chiffre
  // ne couvre pas toute l'organisation — voir lib/kpi.ts : faute d'endpoint
  // d'agrégation côté trust-api, la plupart des compteurs de l'accueil ne
  // portent que sur les dernières factures chargées. Une tuile qui tairait sa
  // portée se lirait comme un total ; on préfère un chiffre modeste et exact.
  scope: string;
}

// Rangée de tuiles chiffrées de la maquette. Défile horizontalement sur
// téléphone plutôt que de se replier en grille : trois tuiles côte à côte
// restent comparables d'un coup d'œil, trois tuiles empilées deviennent une
// liste qu'on lit une par une.
export function KpiRow({ items }: { items: readonly Kpi[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="-mx-4 mb-6 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0">
      {items.map((item) => (
        <Card key={item.label} className="min-w-[45vw] flex-shrink-0 snap-start p-4 sm:min-w-0">
          <p className="font-sans text-[11px] font-semibold tracking-wide text-navy-600 uppercase">{item.label}</p>
          {/* Le chiffre est une donnée, pas un titre : JetBrains Mono, comme les
              montants des listes — même famille pour la même nature d'information. */}
          <p className="mt-1.5 font-mono text-xl font-bold text-navy-950">{item.value}</p>
          <p className="mt-1 text-xs text-navy-600">{item.scope}</p>
        </Card>
      ))}
    </div>
  );
}
