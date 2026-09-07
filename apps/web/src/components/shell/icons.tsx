// Jeu d'icônes de la barre d'onglets. Tracées à la main plutôt qu'importées
// d'une librairie : cinq glyphes ne justifient pas une dépendance de plus à
// télécharger sur une connexion mobile guinéenne (DAT), et un SVG inline se
// met à la couleur du texte sans configuration.
//
// Toutes en `currentColor` — jamais une couleur en dur : l'onglet actif change
// la couleur du texte, l'icône suit sans que personne ait à y penser.
// `aria-hidden` sur toutes : le libellé de l'onglet porte déjà le sens, une
// icône annoncée en plus ne ferait que doubler l'annonce.

const COMMON_PROPS = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function HomeIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-5.5h5V20" />
    </svg>
  );
}

export function InvoiceIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14.5 3v4.5H19" />
      <path d="M9 12h6M9 15.5h6" />
    </svg>
  );
}

export function CustomersIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <circle cx="9.5" cy="8.5" r="3.5" />
      <path d="M3.5 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <path d="M16.5 5.5a3.5 3.5 0 0 1 0 6.8" />
      <path d="M18 14.9c1.6.8 2.6 2.3 2.6 4.1" />
    </svg>
  );
}

export function MoreIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </svg>
  );
}

// Trois traits : le glyphe universel du menu. MoreIcon (trois points) reste
// distincte — elle dit « autres options », celle-ci dit « la navigation ».
export function MenuIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg {...COMMON_PROPS} strokeWidth={2.25}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// Correspondance href → icône. Une table ici plutôt qu'un champ `icon` dans
// nav.ts : nav.ts est de la logique pure (testée sans rendu), y poser du JSX
// l'obligerait à devenir un fichier .tsx et à traîner React dans ses tests.
const TAB_ICONS: Record<string, () => React.JSX.Element> = {
  "/dashboard": HomeIcon,
  "/dashboard/invoices": InvoiceIcon,
  "/dashboard/customers": CustomersIcon,
};

export function TabIcon({ href }: { href: string }) {
  const Icon = TAB_ICONS[href] ?? MoreIcon;
  return <Icon />;
}
