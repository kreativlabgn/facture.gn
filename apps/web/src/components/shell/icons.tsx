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

// Les glyphes suivants servent la barre latérale desktop, qui montre AUSSI les
// entrées du tiroir « Plus » — repliée, elle n'a que l'icône pour les
// distinguer, et cinq fois le même glyphe ne distinguerait rien.

export function ProductsIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5" />
      <path d="M12 12v9" />
    </svg>
  );
}

export function UssdIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <rect x="7" y="2.5" width="10" height="19" rx="1.5" />
      <path d="M10 6.5h4M10 10h4M10 13.5h4" />
      <path d="M12 18.5h.01" />
    </svg>
  );
}

export function CreditsIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <ellipse cx="12" cy="7" rx="7" ry="3" />
      <path d="M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7" />
      <path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
    </svg>
  );
}

export function ReferralIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M4 10h16v10H4z" />
      <path d="M12 10v10M3 7h18v3H3z" />
      <path d="M12 7c-1.5-3-5-3-5-1s3.5 1 5 1c1.5 0 5 1 5-1s-3.5-2-5 1z" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h12M20 18h.01" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

export function CabinetIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5V21" />
      <path d="M16 10h3a1 1 0 0 1 1 1v10" />
      <path d="M3 21h18" />
      <path d="M7.5 8h2M10.5 8h2M7.5 11.5h2M10.5 11.5h2M7.5 15h2M10.5 15h2" />
      <path d="M9 21v-3h2v3" />
    </svg>
  );
}

export function LogoutIcon() {
  return (
    <svg {...COMMON_PROPS}>
      <path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10" />
      <path d="m15 8 4 4-4 4" />
      <path d="M19 12H9" />
    </svg>
  );
}

// Correspondance href → icône. Une table ici plutôt qu'un champ `icon` dans
// nav.ts : nav.ts est de la logique pure (testée sans rendu), y poser du JSX
// l'obligerait à devenir un fichier .tsx et à traîner React dans ses tests.
// Couvre PRIMARY_TABS et MORE_ENTRIES ; une entrée ajoutée à nav.ts sans ligne
// ici retombe sur MoreIcon — visible, pas cassé.
const TAB_ICONS: Record<string, () => React.JSX.Element> = {
  "/dashboard": HomeIcon,
  "/dashboard/invoices": InvoiceIcon,
  "/dashboard/customers": CustomersIcon,
  "/dashboard/products": ProductsIcon,
  "/dashboard/ussd": UssdIcon,
  "/dashboard/credits": CreditsIcon,
  "/dashboard/parrainage": ReferralIcon,
  "/dashboard/settings": SettingsIcon,
};

export function TabIcon({ href }: { href: string }) {
  const Icon = TAB_ICONS[href] ?? MoreIcon;
  return <Icon />;
}
