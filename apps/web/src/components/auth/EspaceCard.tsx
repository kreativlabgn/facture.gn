import { ButtonLink } from "@/components/ui";
import type { Espace } from "@/lib/espaces";

// Carte d'un espace (landing §espaces, hub /inscription). Une structure, deux
// formes d'actions, décidées par la donnée et jamais par l'écran qui l'affiche :
//
//   • professionnel (creation non null) — DEUX boutons, toujours dans le même
//     ordre : « Se connecter » en secondaire, « Créer… » en primaire. Le
//     visiteur n'a plus à deviner si la carte est une porte d'entrée ou une
//     porte d'inscription : elle est les deux, explicitement.
//   • acheteur (creation null) — UN bouton. Il n'y a pas de compte à créer et
//     on ne fait pas semblant.
//
// La hiérarchie visuelle est celle du Design System : `accent` (Or) pour
// l'espace mis en avant, `primary` (Navy) pour les autres — jamais deux Or
// sur la même rangée, sinon l'accent ne signale plus rien (Button.tsx).
//
// `heading` : sur la landing, les cartes suivent un <h2> de section (→ h3) ;
// sur /inscription elles suivent directement le <h1> (→ h2).
export function EspaceCard({ espace, heading = "h3" }: { espace: Espace; heading?: "h2" | "h3" }) {
  const Heading = heading;
  const principale = espace.creation ?? espace.connexion;

  return (
    <article
      aria-labelledby={`espace-${espace.id}`}
      className={`flex flex-col rounded-2xl border bg-white p-7 ${espace.accent ? "border-or" : "border-navy-100"}`}
    >
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-navy-600">{espace.eyebrow}</p>
      <Heading id={`espace-${espace.id}`} className="mt-3 font-display text-2xl font-bold text-navy-950">
        {espace.titre}
      </Heading>
      <p className="mt-3 text-sm leading-relaxed text-navy-600">{espace.texte}</p>

      <div className="mt-auto flex flex-col gap-3 pt-8">
        {espace.creation ? (
          <ButtonLink href={espace.connexion.href} variant="secondary" className="w-full">
            {espace.connexion.label}
          </ButtonLink>
        ) : null}
        <ButtonLink href={principale.href} variant={espace.accent ? "accent" : "primary"} className="w-full">
          {principale.label}
        </ButtonLink>
        {espace.note ? <p className="text-center text-xs text-navy-600">{espace.note}</p> : null}
      </div>
    </article>
  );
}
