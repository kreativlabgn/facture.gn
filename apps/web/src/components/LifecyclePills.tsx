import { etapesDuCycle, type FactureCycleDeVie, type TonEtape } from "@/lib/invoice-lifecycle";
import { Badge, type BadgeTone } from "@/components/ui";

// Les quatre statuts interopérables du parcours légal (LFI 2025) — une RANGÉE
// de pastilles, jamais un badge unique.
//
// C'est la conséquence directe de leur orthogonalité (voir invoice-lifecycle.ts) :
// une facture déposée, approuvée, encaissée ET contestée existe. Un badge
// unique « le plus avancé » choisirait pour le commerçant lequel des trois
// autres il ignore — et ce serait précisément le litige qu'il perdrait de vue.
//
// Ce composant NE REMPLACE PAS StatusPill : celle-ci répond à « puis-je encore
// modifier ce document », question distincte de « où en est-il vis-à-vis de
// l'administration ». Les deux se lisent côte à côte.

const TONS: Record<TonEtape, BadgeTone> = {
  succes: "green",
  confiance: "blue",
  alerte: "amber",
};

export function LifecyclePills({
  facture,
  detaille = false,
}: {
  facture: FactureCycleDeVie;
  /** Sur le détail d'une facture, chaque pastille est suivie de son
   *  explication : c'est l'écran où le commerçant vient comprendre. Dans une
   *  liste, elle serait du bruit — la pastille seule suffit à repérer. */
  detaille?: boolean;
}) {
  const etapes = etapesDuCycle(facture);
  // Aucune étape n'est un état NORMAL (une facture émise ce matin) : rendre une
  // rangée vide, ou pire un « aucun statut », inventerait un signal.
  if (etapes.length === 0) {
    return null;
  }

  if (!detaille) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {etapes.map((etape) => (
          <Badge key={etape.cle} tone={TONS[etape.ton]}>
            {etape.label}
          </Badge>
        ))}
      </span>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {etapes.map((etape) => (
        <li key={etape.cle} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Badge tone={TONS[etape.ton]}>{etape.label}</Badge>
          <span className="text-sm text-navy-600">{etape.aide}</span>
        </li>
      ))}
    </ul>
  );
}
