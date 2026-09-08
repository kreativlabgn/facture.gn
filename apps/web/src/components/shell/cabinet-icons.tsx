// Jeu d'icônes de l'espace cabinet. Mêmes règles qu'icons.tsx : tracées à la
// main plutôt qu'importées, `currentColor` partout, `aria-hidden` partout — le
// libellé de l'entrée porte déjà le sens.
//
// 18px et non 24 : la barre latérale du cabinet est dense (trois groupes,
// jusqu'à huit entrées), alors que la barre d'onglets marchand n'en compte que
// quatre et vise le pouce.

const COMMON_PROPS = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Vue d'ensemble du cabinet. */
export function OverviewIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

/** Les PME suivies — une devanture de commerce. */
export function ClientsIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M3.5 8.5 5 4h14l1.5 4.5" />
      <path d="M3.5 8.5a2.5 2.5 0 0 0 4.25 1.75A2.5 2.5 0 0 0 12 10.25a2.5 2.5 0 0 0 4.25 0A2.5 2.5 0 0 0 20.5 8.5" />
      <path d="M5 11.5V20h14v-8.5" />
      <path d="M10 20v-4.5h4V20" />
    </svg>
  );
}

/** Mandats — un document scellé. */
export function MandateIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M6 3h8l4 4v9" />
      <path d="M14 3v4h4" />
      <path d="M6 3v17h6" />
      <circle cx="17" cy="18" r="3" />
      <path d="M17 15.5V18l1.5 1" />
    </svg>
  );
}

/** Collaborateurs. */
export function TeamIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 20v-1a5.5 5.5 0 0 1 11 0v1" />
      <path d="M16 5.5a3.25 3.25 0 0 1 0 5" />
      <path d="M17.5 20v-1a5.5 5.5 0 0 0-1.75-4" />
    </svg>
  );
}

/** Le cabinet lui-même — un immeuble à colonnes. */
export function PracticeIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10v9M9.5 10v9M14.5 10v9M19 10v9" />
      <path d="M3 20h18" />
    </svg>
  );
}

/** Retour à l'espace marchand — une flèche qui sort. */
export function ExitIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
      <path d="M10 8 6 12l4 4" />
      <path d="M6 12h9" />
    </svg>
  );
}

/** Fermeture de session. Distincte d'ExitIcon : sortir vers son commerce et
 *  fermer sa session ne sont pas la même action, et les confondre dans un même
 *  glyphe ferait cliquer sur l'une en croyant faire l'autre. */
export function LogoutIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" />
      <path d="m15 8 4 4-4 4" />
      <path d="M19 12H9" />
    </svg>
  );
}

/** Chevron du sélecteur de cabinet. */
export function SwitchIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="m8 9 4-4 4 4" />
      <path d="m8 15 4 4 4-4" />
    </svg>
  );
}
