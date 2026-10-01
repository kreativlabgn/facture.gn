import { etapeLabel, type EtapeId, type ProfilTunnel } from "@/lib/etapes-inscription";

// Continuité visuelle entre /register (écran 1) et /onboarding ou
// /nouveau-cabinet (écran 2) : rien n'annonçait, avant ce composant, qu'un
// second écran — propre au profil — suivait le formulaire de compte, et
// l'écran 2 atterrissait dans un habillage sans aucun lien avec le premier.
//
// Deux segments plutôt qu'un simple texte « Étape X sur 2 » : la position
// (lequel des deux est plein) porte l'information EN PLUS du texte, jamais à
// sa place (WCAG 1.4.1 — ne jamais coder une information par la seule
// couleur). L'Or marque l'écran EN COURS, le Navy plein l'écran déjà franchi,
// le Navy clair l'écran à venir — jamais deux segments Or à la fois.
export function EtapeIndicateur({ profil, etape }: { profil: ProfilTunnel; etape: EtapeId }) {
  const { numero, libelle } = etapeLabel(profil, etape);

  return (
    <div className="mb-5 flex items-center gap-3">
      <ol className="flex items-center gap-1.5" aria-hidden="true">
        <li className={`h-1.5 w-6 rounded-full ${etape === "compte" ? "bg-or" : "bg-navy-950"}`} />
        <li className={`h-1.5 w-6 rounded-full ${etape === "structure" ? "bg-or" : "bg-navy-100"}`} />
      </ol>
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-navy-600">
        Étape {numero} sur 2 · {libelle}
      </p>
    </div>
  );
}
