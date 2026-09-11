// ─────────────────────────────────────────────────────────────────────────────
// ILLUSTRATIONS & GRAPHIQUES — SVG écrits à la main, zéro dépendance.
//
// Pas de lucide-react, pas de recharts, pas de PNG : sur un forfait data
// guinéen, une bibliothèque d'icônes ou de graphes coûte plus cher en octets
// que tout le contenu de la page qu'elle décore. Ces tracés pèsent ce que pèse
// leur balisage, et rien de plus.
//
// ── DEUX RÈGLES QUI NE SE NÉGOCIENT PAS ─────────────────────────────────────
//
// 1. AUCUNE COULEUR EN DUR. Tout passe par `currentColor` ou par un token
//    Tailwind (`fill-or`, `stroke-navy-100`). Le garde-fou
//    design-system.guardrails.spec.ts fait échouer la CI sur un `#RRGGBB`
//    littéral, et il a raison : une couleur écrite ici ne suivrait aucune
//    évolution de la charte.
//
// 2. AUCUN DÉGRADÉ (R-01). Les surfaces se distinguent par l'OPACITÉ d'un
//    aplat (`fillOpacity`), jamais par un `linearGradient` — même règle qu'en
//    print, et le rendu reste net sur un écran d'entrée de gamme.
//
// ── POURQUOI `ton` PLUTÔT QU'UNE COULEUR ────────────────────────────────────
// Ces graphiques vivent sur deux fonds : le blanc de la landing et le Navy de
// l'espace cabinet. Sur Navy, un tracé `navy-100` disparaît purement et
// simplement. Le prop `ton` choisit donc la famille de teintes AVANT le rendu,
// plutôt que de laisser un composant hériter d'une couleur invisible.
//
// Tous portent `aria-hidden` : chacun double une donnée déjà écrite en toutes
// lettres à côté. Un lecteur d'écran qui les annoncerait lirait deux fois le
// même chiffre — un graphique n'est jamais la SOURCE de l'information ici.
// ─────────────────────────────────────────────────────────────────────────────

export type Ton = "clair" | "sombre";

/** Trait de structure (axes, grilles, contours) — le seul endroit où les deux
 *  fonds divergent vraiment. */
function traitStructure(ton: Ton): string {
  return ton === "sombre" ? "stroke-navy-800" : "stroke-navy-100";
}

/** Aplat de remplissage neutre. */
function aplatNeutre(ton: Ton): string {
  return ton === "sombre" ? "fill-white" : "fill-navy-950";
}

const TRAIT = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

// ── Courbe d'encaissements ──────────────────────────────────────────────────

/** Douze mois d'encaissements, en aire + ligne.
 *
 *  Les points sont fournis en valeurs MÉTIER (des montants), pas en
 *  coordonnées : la mise à l'échelle se fait ici, sur le maximum de la série.
 *  Un appelant qui devrait calculer des `y` en pixels finirait par recopier une
 *  hauteur en dur, et le graphique mentirait au premier changement de gabarit. */
export function CourbeEncaissements({
  points,
  ton = "clair",
  className = "h-32 w-full",
}: {
  points: number[];
  ton?: Ton;
  className?: string;
}) {
  const LARGEUR = 320;
  const HAUTEUR = 120;
  const MARGE = 6;

  const maximum = Math.max(...points, 1);
  const pas = points.length > 1 ? (LARGEUR - MARGE * 2) / (points.length - 1) : 0;

  const coordonnees = points.map((valeur, index) => {
    const x = MARGE + index * pas;
    const y = HAUTEUR - MARGE - (valeur / maximum) * (HAUTEUR - MARGE * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const ligne = `M ${coordonnees.join(" L ")}`;
  const aire = `${ligne} L ${(LARGEUR - MARGE).toFixed(1)},${HAUTEUR - MARGE} L ${MARGE},${HAUTEUR - MARGE} Z`;

  return (
    <svg
      viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      {/* Trois lignes de repère, pas dix : la grille situe l'ordre de grandeur,
          elle n'est pas là pour qu'on y lise une valeur. */}
      {[0.25, 0.5, 0.75].map((fraction) => (
        <line
          key={fraction}
          x1={MARGE}
          x2={LARGEUR - MARGE}
          y1={MARGE + fraction * (HAUTEUR - MARGE * 2)}
          y2={MARGE + fraction * (HAUTEUR - MARGE * 2)}
          className={traitStructure(ton)}
          strokeWidth={1}
        />
      ))}
      <path d={aire} className="fill-or" fillOpacity={ton === "sombre" ? 0.22 : 0.16} />
      <path d={ligne} fill="none" className="stroke-or" strokeWidth={2.5} {...TRAIT} />
      {/* Un seul point marqué — le dernier. Douze pastilles feraient un collier
          sans information ; celle-ci dit « on en est là ». */}
      <circle
        cx={MARGE + (points.length - 1) * pas}
        cy={HAUTEUR - MARGE - (points[points.length - 1] / maximum) * (HAUTEUR - MARGE * 2)}
        r={3.5}
        className="fill-or"
      />
    </svg>
  );
}

// ── Histogramme de volume ───────────────────────────────────────────────────

/** Volume mensuel en barres. `accentuer` met une barre en Or — celle du mois
 *  courant, ou celle dont on parle dans le texte à côté. */
export function BarresVolume({
  valeurs,
  accentuer,
  ton = "clair",
  className = "h-28 w-full",
}: {
  valeurs: number[];
  accentuer?: number;
  ton?: Ton;
  className?: string;
}) {
  const LARGEUR = 320;
  const HAUTEUR = 110;
  const BASE = HAUTEUR - 8;
  const maximum = Math.max(...valeurs, 1);
  const largeurBarre = (LARGEUR - 8) / valeurs.length;

  return (
    <svg viewBox={`0 0 ${LARGEUR} ${HAUTEUR}`} aria-hidden="true" className={className}>
      <line x1={4} x2={LARGEUR - 4} y1={BASE} y2={BASE} className={traitStructure(ton)} strokeWidth={1} />
      {valeurs.map((valeur, index) => {
        const hauteur = Math.max((valeur / maximum) * (BASE - 10), 2);
        const accentuee = index === accentuer;
        return (
          <rect
            key={index}
            x={4 + index * largeurBarre + largeurBarre * 0.22}
            y={BASE - hauteur}
            width={largeurBarre * 0.56}
            height={hauteur}
            rx={2}
            className={accentuee ? "fill-or" : aplatNeutre(ton)}
            fillOpacity={accentuee ? 1 : ton === "sombre" ? 0.32 : 0.14}
          />
        );
      })}
    </svg>
  );
}

// ── Anneau de répartition ───────────────────────────────────────────────────

export interface PartAnneau {
  libelle: string;
  valeur: number;
  /** Classe de token Tailwind — `stroke-or`, `stroke-green`… Jamais un hex. */
  trait: string;
}

/** Anneau de répartition, tracé en `stroke-dasharray` sur un seul cercle : un
 *  arc par part, décalé du cumul des précédentes. Aucune trigonométrie, aucun
 *  chemin à recalculer quand une part change.
 *
 *  Le trou central porte le total — c'est le chiffre qu'on cherche d'abord, et
 *  le placer ailleurs obligerait l'œil à faire l'aller-retour. */
export function AnneauRepartition({
  parts,
  total,
  legende,
  ton = "clair",
  className = "h-40 w-40",
}: {
  parts: PartAnneau[];
  total: string;
  legende: string;
  ton?: Ton;
  className?: string;
}) {
  const RAYON = 42;
  const CIRCONFERENCE = 2 * Math.PI * RAYON;
  const somme = parts.reduce((cumul, part) => cumul + part.valeur, 0) || 1;

  // Les arcs sont calculés AVANT le rendu, pas accumulés pendant. Un compteur
  // incrémenté dans le `.map()` du JSX est une réassignation en cours de rendu
  // (react-hooks/immutability) : sur un re-rendu concurrent, React peut
  // reprendre la liste en cours de route et l'offset repartirait d'une valeur
  // déjà consommée — les arcs se chevaucheraient.
  const arcs = parts.map((part, index) => {
    const precedents = parts.slice(0, index).reduce((cumul, autre) => cumul + autre.valeur, 0);
    return {
      ...part,
      longueur: (part.valeur / somme) * CIRCONFERENCE,
      offset: (precedents / somme) * CIRCONFERENCE,
    };
  });

  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={className}>
      <circle
        cx={60}
        cy={60}
        r={RAYON}
        fill="none"
        className={traitStructure(ton)}
        strokeWidth={14}
      />
      {arcs.map((arc) => (
        <circle
          key={arc.libelle}
          cx={60}
          cy={60}
          r={RAYON}
          fill="none"
          className={arc.trait}
          strokeWidth={14}
          strokeLinecap="butt"
          strokeDasharray={`${arc.longueur.toFixed(2)} ${(CIRCONFERENCE - arc.longueur).toFixed(2)}`}
          strokeDashoffset={(-arc.offset).toFixed(2)}
          // Sans cette rotation, le premier arc démarre à 3 heures. On lit un
          // camembert depuis le haut.
          transform="rotate(-90 60 60)"
        />
      ))}
      <text
        x={60}
        y={57}
        textAnchor="middle"
        className={ton === "sombre" ? "fill-white" : "fill-navy-950"}
        style={{ fontSize: "20px", fontWeight: 700 }}
      >
        {total}
      </text>
      <text
        x={60}
        y={73}
        textAnchor="middle"
        className={ton === "sombre" ? "fill-or" : "fill-navy-950"}
        fillOpacity={ton === "sombre" ? 1 : 0.66}
        style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.08em" }}
      >
        {legende}
      </text>
    </svg>
  );
}

// ── Sceau de certification ──────────────────────────────────────────────────

/** Illustration du scellement : un hexagone, une chaîne de maillons, une coche.
 *  Trois formes, pas un dessin — le propos est « chaque pièce tient la
 *  suivante », pas « voici un cadenas ». */
export function SceauCertification({ className = "h-28 w-28" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true" className={className}>
      <path
        d="M60 8 106 33.5v53L60 112 14 86.5v-53z"
        fill="none"
        className="stroke-or"
        strokeWidth={2.5}
        {...TRAIT}
      />
      <path
        d="M60 22 94 40.5v39L60 98 26 79.5v-39z"
        className="fill-or"
        fillOpacity={0.12}
        stroke="none"
      />
      <path
        d="m44 60 11 11 22-24"
        fill="none"
        className="stroke-or"
        strokeWidth={4}
        {...TRAIT}
      />
      {/* Les trois maillons du chaînage, à l'extérieur du sceau : la pièce
          scellée n'est jamais seule, elle tient à celles d'avant. */}
      {[24, 60, 96].map((x) => (
        <circle key={x} cx={x} cy={112} r={3} className="fill-or" fillOpacity={0.55} />
      ))}
      <line x1={27} x2={57} y1={112} y2={112} className="stroke-or" strokeWidth={1.5} strokeOpacity={0.55} />
      <line x1={63} x2={93} y1={112} y2={112} className="stroke-or" strokeWidth={1.5} strokeOpacity={0.55} />
    </svg>
  );
}

// ── Flux du Capital Layer ───────────────────────────────────────────────────

/** Trois jalons reliés : facture approuvée → établissement agréé → trésorerie.
 *  Le trait entre les jalons porte le délai, parce que le délai EST l'argument. */
export function FluxCapital({
  ton = "clair",
  className = "h-24 w-full",
}: {
  ton?: Ton;
  className?: string;
}) {
  const jalons = [10, 160, 310];

  return (
    <svg viewBox="0 0 320 90" aria-hidden="true" className={className}>
      <line x1={10} x2={310} y1={38} y2={38} className={traitStructure(ton)} strokeWidth={2} />
      <line x1={10} x2={160} y1={38} y2={38} className="stroke-or" strokeWidth={2.5} {...TRAIT} />
      {jalons.map((x, index) => (
        <g key={x}>
          <circle
            cx={x}
            cy={38}
            r={index === 2 ? 9 : 7}
            className={index === 2 ? "fill-or" : aplatNeutre(ton)}
            fillOpacity={index === 2 ? 1 : ton === "sombre" ? 0.85 : 1}
          />
          {index === 2 ? (
            <path d="m305 38 3.5 3.5 6-7" fill="none" className="stroke-navy-950" strokeWidth={2} {...TRAIT} />
          ) : null}
        </g>
      ))}
      <text
        x={85}
        y={22}
        textAnchor="middle"
        className={ton === "sombre" ? "fill-or" : "fill-navy-950"}
        style={{ fontSize: "11px", fontWeight: 700 }}
      >
        24 h
      </text>
    </svg>
  );
}

// ── Cloisonnement RLS ───────────────────────────────────────────────────────

/** Trois colonnes séparées par un mur plein : l'isolation entre entreprises,
 *  dessinée comme elle est appliquée — sous la requête, pas au-dessus. */
export function CloisonsEtanches({
  ton = "sombre",
  className = "h-28 w-full",
}: {
  ton?: Ton;
  className?: string;
}) {
  return (
    <svg viewBox="0 0 320 110" aria-hidden="true" className={className}>
      {[0, 1, 2].map((colonne) => {
        const x = 12 + colonne * 102;
        return (
          <g key={colonne}>
            <rect
              x={x}
              y={14}
              width={88}
              height={64}
              rx={8}
              className={aplatNeutre(ton)}
              fillOpacity={ton === "sombre" ? 0.08 : 0.05}
              stroke="none"
            />
            <rect
              x={x}
              y={14}
              width={88}
              height={64}
              rx={8}
              fill="none"
              className={traitStructure(ton)}
              strokeWidth={1.5}
            />
            {[0, 1, 2].map((ligne) => (
              <rect
                key={ligne}
                x={x + 12}
                y={28 + ligne * 14}
                width={ligne === 2 ? 40 : 64}
                height={5}
                rx={2.5}
                className="fill-or"
                fillOpacity={0.5}
                stroke="none"
              />
            ))}
          </g>
        );
      })}
      {/* Les deux murs. Ils descendent SOUS les boîtes : la barrière n'est pas
          entre les écrans, elle est sous la donnée. */}
      {[105, 207].map((x) => (
        <line key={x} x1={x} x2={x} y1={6} y2={100} className="stroke-or" strokeWidth={2.5} strokeOpacity={0.8} />
      ))}
    </svg>
  );
}
