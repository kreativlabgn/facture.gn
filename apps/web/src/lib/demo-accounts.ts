import { normaliserMsisdnGn } from "./phone-gn";
import { COMMISSION_CAP_CENTIMES, fraisTransaction, type Tier } from "./plans";

// ─────────────────────────────────────────────────────────────────────────────
// COMPTES DE DÉMONSTRATION — la vitrine, et rien d'autre.
//
// Ce module ne parle à AUCUNE API. Il ne crée pas de session, ne pose pas de
// cookie, ne connaît pas trust-api : c'est un jeu de données figé, servi par des
// écrans `/demo/*` qui n'existent que pour montrer des surfaces peuplées. Un
// visiteur qui ouvre ces pages ne voit jamais la donnée d'un vrai marchand, et
// un vrai marchand ne voit jamais celles-ci — les deux mondes ne se touchent
// nulle part.
//
// ── POURQUOI LES CHIFFRES SONT CALCULÉS, ET NON ÉCRITS ──────────────────────
// Chaque montant de frais affiché en démonstration passe par `fraisTransaction`
// (lib/plans.ts), c'est-à-dire par le MÊME calcul que le guichet de paiement :
// plafond de commission et cascade Djomy compris. Une vitrine qui recopie ses
// nombres à la main se périme au premier changement de barème, et personne ne
// s'en aperçoit — jusqu'à la démonstration devant un client, où le chiffre du
// diaporama et celui de l'écran de paiement ne se ressemblent plus.
//
// ── DEUX PORTES, ET LES DEUX FONCTIONNENT ───────────────────────────────────
// 1. Les écrans `/demo/*` s'ouvrent sans compte, sans session et sans appel
//    réseau — c'est le chemin le plus court pour voir la plateforme peuplée.
// 2. Les identifiants ci-dessous ouvrent de VRAIS comptes, créés en base par
//    `scripts/seed-demo-accounts.mjs`. Le marchand y porte les mêmes 14
//    factures et le même volume que la vitrine ; le cabinet y supervise ses
//    cinq mandats.
//
// Ils ont d'abord été de FAUX identifiants — affichés sous des libellés de
// formulaire de connexion alors qu'ils n'ouvraient rien. Le visiteur faisait la
// chose évidente, allait sur /login, et repartait convaincu que la plateforme
// était en panne. La leçon n'était pas « cacher les identifiants » : c'était
// que ce qui compte n'est pas ce qu'un identifiant OUVRE, mais le geste qu'il
// PROVOQUE. Puisque le geste est inévitable, on l'a rendu payant.
//
// ── CE QUE CES COMPTES SONT, ET NE SONT PAS ─────────────────────────────────
// Ce sont des comptes PARTAGÉS et PUBLICS : n'importe qui peut s'y connecter et
// y écrire. Ils ne doivent donc jamais porter autre chose que des données de
// démonstration, et rien de ce qu'un visiteur y fait n'a de valeur. Le mot de
// passe n'est pas un secret — c'est une étiquette, au même titre que le numéro.
// ─────────────────────────────────────────────────────────────────────────────

/** Mot de passe commun aux comptes de démonstration.
 *
 *  Recopié depuis `scripts/demo-dataset.json`, qui est la source du seed —
 *  `demo-seed.spec.ts` échoue si les deux divergent. Huit caractères minimum :
 *  trust-api refuse en dessous (auth/dto/register.dto.ts), ce qui condamnait
 *  d'avance l'ancien « code OTP » à six chiffres. */
export const MOT_DE_PASSE_DEMO = "DemoFacture2026";

/** Palier des comptes de démonstration : le gratuit, celui que voit un visiteur
 *  qui n'a encore rien signé. C'est aussi le barème le plus défavorable — une
 *  vitrine ne doit pas montrer un tarif meilleur que celui qu'on facturera. */
export const TIER_DEMO: Tier = "freemium";

/** Facture de référence du barème : 1 000 000 GNF, exactement celle du portail
 *  client ci-dessous. Sous le plafond de commission, donc son taux EST le taux
 *  nominal du palier — c'est le seul montant pour lequel « le barème » et « ce
 *  que je paie » sont le même nombre. */
const REFERENCE_BAREME_CENTIMES = "100000000";

// ── 1. Compte marchand — PME freemium ───────────────────────────────────────

export const MARCHAND_DEMO = {
  // Format CANONIQUE (+224…), pas la forme locale « 622001122 » : c'est celui
  // que trust-api accepte (msisdnSchema), donc le seul qu'on puisse afficher
  // sans que le visiteur qui le recopie tombe sur un refus de format. La
  // connexion normalise aussi les formes locales, mais une carte de
  // démonstration n'a aucune raison de faire dépendre son succès de ce filet.
  telephone: "+224622001122",
  motDePasse: MOT_DE_PASSE_DEMO,
  organisation: "Établissements Camara & Fils",
  activite: "Quincaillerie et matériaux — Madina, Conakry",
  tier: TIER_DEMO,
} as const;

/** Un message du fil de contestation. `auteur` dit QUI écrit : le client
 *  conteste, le marchand répond. Un litige sans fil est un statut sans
 *  histoire — l'écran montrerait un drapeau rouge sans rien à en faire. */
export interface MessageLitige {
  auteur: "client" | "marchand";
  quand: string;
  texte: string;
}

/** L'issue amiable d'une contestation, telle que le marchand la propose.
 *
 *  Deux voies, et une seule est un avoir — c'est le point que la démonstration
 *  doit faire passer. Un écran qui n'offrirait que « émettre un avoir »
 *  enseignerait qu'une contestation donne toujours raison au client ; or la
 *  moitié des litiges de ce carnet se règlent en produisant la preuve et en
 *  maintenant la facture. Les deux issues sont amiables : ce qui les sépare,
 *  c'est qui avait raison, pas qui a crié le plus fort.
 *
 *  L'avoir est une PIÈCE NOUVELLE, jamais une modification de la facture
 *  contestée : une facture certifiée ne se réécrit pas. Le montant de
 *  la facture reste donc intact — le volume émis du portefeuille ne bouge pas
 *  d'un franc quand un avoir est émis, et c'est voulu. */
export type ResolutionLitige =
  | { voie: "avoir"; avoirCentimes: string; motif: string }
  | { voie: "maintien"; motif: string };

/** Les quatre colonnes sont ORTHOGONALES (voir lib/invoice-lifecycle.ts) : une
 *  facture peut être déposée, approuvée, encaissée ET contestée en même temps.
 *  Les modéliser en quatre booléens plutôt qu'en un statut unique est le seul
 *  moyen de représenter la situation qui appelle vraiment un arbitrage. */
export interface FactureDemo {
  numero: string;
  client: string;
  emiseLe: string;
  montantCentimes: string;
  deposee: boolean;
  approuvee: boolean;
  litige: boolean;
  encaissee: boolean;
  fil: MessageLitige[];
  /** Présente si et seulement si la facture est contestée. Le spec le vérifie :
   *  un litige sans issue proposée est un écran qui montre un problème et
   *  aucune sortie — exactement ce que ce tableau de bord doit éviter. */
  resolution?: ResolutionLitige;
}

function facture(
  numero: string,
  client: string,
  emiseLe: string,
  montantGnf: number,
  etat: { deposee?: boolean; approuvee?: boolean; litige?: boolean; encaissee?: boolean } = {},
  fil: MessageLitige[] = [],
  resolution?: ResolutionLitige,
): FactureDemo {
  return {
    numero,
    client,
    emiseLe,
    // Saisi en GNF lisible, stocké en centimes comme partout ailleurs (DAT :
    // 100 centimes = 1 GNF). Écrire le montant en clair dans la liste et
    // laisser la conversion ici évite la coquille classique du zéro en trop.
    montantCentimes: String(montantGnf * 100),
    deposee: etat.deposee ?? true,
    approuvee: etat.approuvee ?? false,
    litige: etat.litige ?? false,
    encaissee: etat.encaissee ?? false,
    fil,
    resolution,
  };
}

/** Ce qu'il reste dû après l'avoir, si avoir il y a. Calculé, jamais saisi :
 *  un « net à payer » figé à côté d'un montant et d'un avoir est le troisième
 *  nombre qui finit par contredire les deux autres. */
export function resteDu(facture: FactureDemo): string {
  const resolution = facture.resolution;
  if (!resolution || resolution.voie !== "avoir") {
    return facture.montantCentimes;
  }
  return (BigInt(facture.montantCentimes) - BigInt(resolution.avoirCentimes)).toString();
}

/** 14 factures totalisant EXACTEMENT 45 000 000 GNF — le total est vérifié par
 *  le spec, pas promis par un commentaire. Montants et clients tirés d'un
 *  carnet de commandes plausible à Conakry : mélange B2B, B2G et détail. */
export const FACTURES_MARCHAND_DEMO: FactureDemo[] = [
  facture("FG-2026-0014", "Direction Régionale de la Santé", "2026-09-04", 8_500_000, {
    approuvee: true,
  }),
  facture("FG-2026-0013", "SOGUIPAH SA", "2026-09-02", 6_200_000, {
    approuvee: true,
    encaissee: true,
  }),
  facture("FG-2026-0012", "Entreprise Baldé BTP", "2026-08-29", 5_750_000, { litige: true }, [
    {
      auteur: "client",
      quand: "2026-08-30",
      texte:
        "Le bordereau annonce 40 sacs de ciment, la livraison en comptait 36. Nous contestons la différence.",
    },
    {
      auteur: "marchand",
      quand: "2026-08-30",
      texte:
        "Vérification faite auprès du magasinier : 4 sacs sont restés au dépôt. Nous émettons un avoir sur la différence aujourd’hui.",
    },
    {
      auteur: "client",
      quand: "2026-08-31",
      texte: "Reçu. Nous réglons dès réception de l’avoir.",
    },
  ], {
    voie: "avoir",
    // 4 sacs manquants sur les 40 facturés : un dixième de 5 750 000 GNF.
    avoirCentimes: "57500000",
    motif:
      "4 sacs sur 40 restés au dépôt — avoir à émettre sur la différence, solde attendu sous 48 h.",
  }),
  facture("FG-2026-0011", "Hôtel Kaloum Palace", "2026-08-27", 4_300_000, {
    approuvee: true,
    encaissee: true,
  }),
  facture("FG-2026-0010", "Guinée Distribution SARL", "2026-08-24", 3_900_000, {
    approuvee: true,
    encaissee: true,
  }),
  facture("FG-2026-0009", "Mairie de Ratoma", "2026-08-21", 3_450_000, { approuvee: true }),
  facture("FG-2026-0008", "Cimenterie de Conakry", "2026-08-18", 2_800_000, {
    approuvee: true,
    encaissee: true,
  }),
  facture("FG-2026-0007", "Pharmacie Bhoye", "2026-08-15", 2_400_000, { litige: true }, [
    {
      auteur: "client",
      quand: "2026-08-16",
      texte: "Facture reçue en double : celle-ci fait doublon avec FG-2026-0006 du même mois.",
    },
    {
      auteur: "marchand",
      quand: "2026-08-17",
      texte:
        "Les deux commandes sont distinctes (bons n° 118 et n° 124). Nous joignons les deux bons de livraison signés.",
    },
  ], {
    voie: "maintien",
    motif:
      "Doublon écarté : deux bons de livraison signés produits. Facture maintenue, aucun avoir.",
  }),
  facture("FG-2026-0006", "Pharmacie Bhoye", "2026-08-12", 1_950_000, {
    approuvee: true,
    encaissee: true,
  }),
  facture("FG-2026-0005", "Atelier Diallo Métal", "2026-08-08", 1_600_000, {
    approuvee: true,
    encaissee: true,
  }),
  facture("FG-2026-0004", "Boulangerie Sandervalia", "2026-08-05", 1_250_000, { encaissee: true }),
  facture("FG-2026-0003", "Garage Sylla", "2026-08-01", 1_100_000, {
    approuvee: true,
    encaissee: true,
  }),
  facture("FG-2026-0002", "Ets Touré Négoce", "2026-07-29", 950_000, { encaissee: true }),
  facture("FG-2026-0001", "Client au comptoir — 628 44 17 02", "2026-07-26", 850_000, {
    encaissee: true,
  }),
];

export interface PortefeuilleDemo {
  facturesTotal: number;
  volumeCentimes: string;
  litiges: number;
  approuvees: number;
  encaissees: number;
  /** Frais réellement supportés, facture par facture — jamais un pourcentage
   *  appliqué au volume : le plafond joue PAR ENCAISSEMENT. */
  fraisCentimes: string;
  /** Taux réellement supporté sur ce portefeuille, déduit des deux montants. */
  tauxEffectifBps: number;
  /** Taux du palier sur une facture qui reste sous le plafond. */
  tauxBaremeBps: number;
  /** Ce que le plafond a épargné : frais au barème − frais réels. */
  economiePlafondCentimes: string;
}

const BPS_DENOMINATEUR = BigInt(10000);

/** Agrège un portefeuille comme le ferait un relevé : chaque facture est
 *  tarifée SÉPARÉMENT, puis les frais sont additionnés.
 *
 *  Tarifer le volume d'un seul coup donnerait un chiffre faux et flatteur : le
 *  plafond de commission s'applique à chaque encaissement, pas à la somme de
 *  l'année. Sur ce jeu de données, huit factures sur quatorze le dépassent —
 *  d'où un taux effectif nettement sous le barème, qui est le vrai argument
 *  commercial du palier et non un arrondi favorable.
 *
 *  BigInt de bout en bout, aucun littéral `0n` : la cible de compilation de
 *  `web` est ES2017 (voir lib/plans.ts, même contrainte). */
export function portefeuilleDemo(
  factures: FactureDemo[] = FACTURES_MARCHAND_DEMO,
): PortefeuilleDemo {
  let volume = BigInt(0);
  let frais = BigInt(0);

  for (const item of factures) {
    const detail = fraisTransaction(item.montantCentimes, TIER_DEMO);
    volume += BigInt(detail.marchandise);
    frais += BigInt(detail.fraisTransaction);
  }

  const bareme = fraisTransaction(REFERENCE_BAREME_CENTIMES, TIER_DEMO).tauxEffectifBps;

  // Un portefeuille vide n'a ni taux ni économie — on rend 0 plutôt que de
  // diviser par zéro, comme `tauxEffectifBps` le fait déjà pour une
  // marchandise nulle.
  if (volume <= BigInt(0)) {
    return {
      facturesTotal: factures.length,
      volumeCentimes: "0",
      litiges: 0,
      approuvees: 0,
      encaissees: 0,
      fraisCentimes: "0",
      tauxEffectifBps: 0,
      tauxBaremeBps: bareme,
      economiePlafondCentimes: "0",
    };
  }

  const fraisAuBareme = (volume * BigInt(bareme)) / BPS_DENOMINATEUR;
  const economie = fraisAuBareme > frais ? fraisAuBareme - frais : BigInt(0);

  return {
    facturesTotal: factures.length,
    volumeCentimes: volume.toString(),
    litiges: factures.filter((item) => item.litige).length,
    approuvees: factures.filter((item) => item.approuvee).length,
    encaissees: factures.filter((item) => item.encaissee).length,
    fraisCentimes: frais.toString(),
    // Arrondi au point de base le plus proche, même formule que
    // `tauxEffectifBps` — recopiée ici pour rester en BigInt sur le volume.
    tauxEffectifBps: Number((frais * BPS_DENOMINATEUR * BigInt(2) + volume) / (volume * BigInt(2))),
    tauxBaremeBps: bareme,
    economiePlafondCentimes: economie.toString(),
  };
}

/** Plafond du palier de démonstration, exposé pour l'écran qui explique
 *  POURQUOI le taux effectif décroche du barème. */
export const PLAFOND_DEMO_CENTIMES = COMMISSION_CAP_CENTIMES[TIER_DEMO];

// ── 2. Compte cabinet comptable ─────────────────────────────────────────────

export const CABINET_DEMO = {
  // Numéro d'inscription à l'Ordre : un attribut public d'un cabinet, jamais un
  // moyen de connexion. Le compte, lui, s'ouvre par téléphone comme tous les
  // autres — c'est l'ancien « code d'accès CAB-99 » qui mentait sur ce point.
  numeroOcaecg: "CGA-2026-009",
  telephone: "+224622002233",
  motDePasse: MOT_DE_PASSE_DEMO,
  raisonSociale: "Cabinet Diakité & Associés",
  // Le badge « vérifié par l'Ordre » ne s'auto-décerne pas : la bascule
  // pending → verified est un contrôle humain qui n'a délibérément aucun
  // endpoint (schema.prisma). Une démonstration qui montrerait un cabinet
  // « vérifié » enseignerait au visiteur un état que la plateforme ne sait pas
  // encore produire toute seule.
  statut: "PENDING_VERIFICATION",
  depuis: "2026-06-14",
} as const;

export interface MandatDemo {
  organisation: string;
  secteur: string;
  factures: number;
  volumeCentimes: string;
  litiges: number;
  /** Rang accordé PAR le client, distinct du rang dans le cabinet. */
  role: string;
}

export const MANDATS_CABINET_DEMO: MandatDemo[] = [
  {
    organisation: "Établissements Camara & Fils",
    secteur: "Quincaillerie",
    factures: 14,
    volumeCentimes: "4500000000",
    litiges: 2,
    role: "Comptable externe",
  },
  {
    organisation: "Guinée Distribution SARL",
    secteur: "Import-export",
    factures: 38,
    volumeCentimes: "12750000000",
    litiges: 1,
    role: "Comptable externe",
  },
  {
    organisation: "Hôtel Kaloum Palace",
    secteur: "Hôtellerie",
    factures: 61,
    volumeCentimes: "8900000000",
    litiges: 0,
    role: "Gestionnaire",
  },
  {
    organisation: "Atelier Diallo Métal",
    secteur: "Métallurgie",
    factures: 22,
    volumeCentimes: "3150000000",
    litiges: 1,
    role: "Comptable externe",
  },
  {
    organisation: "Pharmacie Bhoye",
    secteur: "Officine",
    factures: 47,
    volumeCentimes: "6200000000",
    litiges: 0,
    role: "Gestionnaire",
  },
];

/** Volume supervisé, additionné — jamais recopié en tête d'écran. Un total
 *  écrit à la main diverge du tableau qu'il surplombe dès qu'une ligne bouge. */
export function volumeCabinetDemo(mandats: MandatDemo[] = MANDATS_CABINET_DEMO): string {
  return mandats
    .reduce((somme, mandat) => somme + BigInt(mandat.volumeCentimes), BigInt(0))
    .toString();
}

export function facturesCabinetDemo(mandats: MandatDemo[] = MANDATS_CABINET_DEMO): number {
  return mandats.reduce((somme, mandat) => somme + mandat.factures, 0);
}

export function litigesCabinetDemo(mandats: MandatDemo[] = MANDATS_CABINET_DEMO): number {
  return mandats.reduce((somme, mandat) => somme + mandat.litiges, 0);
}

// ── 3. Portail client / guichet de paiement ─────────────────────────────────

/** Les états simulables du guichet. `a_payer` est le seul qui laisse débiter. */
export type StatutCheckoutDemo = "a_payer" | "paid" | "litige";

export const STATUTS_CHECKOUT_DEMO: StatutCheckoutDemo[] = ["a_payer", "paid", "litige"];

export const PORTAIL_DEMO = {
  invoiceId: "test-invoice-uuid",
  numero: "FG-2026-0015",
  marchand: "Établissements Camara & Fils",
  client: "Entreprise Baldé BTP",
  emiseLe: "2026-09-08",
  montantCentimes: "100000000",
} as const;

export interface CheckoutDemo {
  numero: string;
  marchand: string;
  client: string;
  emiseLe: string;
  marchandise: string;
  /** UNE ligne de frais, comme au vrai guichet : la répartition commission /
   *  passerelle est notre plomberie, elle ne change rien à ce que le payeur
   *  débourse. */
  fraisTransaction: string;
  totalPayeur: string;
  tauxEffectifBps: number;
}

/** Rend le guichet de démonstration pour l'identifiant public annoncé, et pour
 *  lui seul : tout autre identifiant repart vers le vrai money-api. Le test
 *  d'égalité est STRICT, jamais un `startsWith` — un préfixe partagé
 *  détournerait de vraies factures vers la vitrine. */
export function checkoutDemo(invoiceId: string): CheckoutDemo | null {
  if (invoiceId !== PORTAIL_DEMO.invoiceId) {
    return null;
  }

  const detail = fraisTransaction(PORTAIL_DEMO.montantCentimes, TIER_DEMO);
  return {
    numero: PORTAIL_DEMO.numero,
    marchand: PORTAIL_DEMO.marchand,
    client: PORTAIL_DEMO.client,
    emiseLe: PORTAIL_DEMO.emiseLe,
    marchandise: detail.marchandise,
    fraisTransaction: detail.fraisTransaction,
    totalPayeur: detail.totalPayeur,
    tauxEffectifBps: detail.tauxEffectifBps,
  };
}

/** Le bouton Mobile Money déclenche un débit réel : il se ferme sur la DONNÉE,
 *  jamais par un `disabled` posé à l'écran.
 *
 *   • `paid`   — la facture est déjà réglée. Rouvrir le paiement, c'est offrir
 *                un second débit pour une créance éteinte.
 *   • `litige` — le montant est précisément ce dont on discute. Encaisser
 *                pendant la contestation retire au client le seul levier qu'il
 *                a, et transforme un désaccord réparable en remboursement. */
export function paiementOuvert(statut: StatutCheckoutDemo): boolean {
  return statut === "a_payer";
}

// ── 4. Reconnaître un identifiant de démonstration saisi dans /login ────────

export interface ScenarioDemo {
  /** Ce qu'un visiteur peut avoir retenu du scénario et retaper. */
  identifiant: string;
  /** Nommé pour finir la phrase « Ouvrir … ». */
  libelle: string;
  href: string;
}

export const SCENARIOS_DEMO: readonly ScenarioDemo[] = [
  {
    identifiant: MARCHAND_DEMO.telephone,
    libelle: "le tableau de bord marchand",
    href: "/demo/marchand",
  },
  {
    identifiant: CABINET_DEMO.numeroOcaecg,
    libelle: "la console cabinet",
    href: "/demo/cabinet",
  },
];

/** Rend le scénario correspondant à une saisie, ou `null`.
 *
 *  Ces comptes EXISTENT désormais : une saisie correcte ouvre une session, et
 *  cette fonction n'est jamais consultée. Elle sert au cas d'à côté — le
 *  visiteur qui a le bon numéro et un mot de passe erroné, ou qui arrive après
 *  qu'un environnement a été réinitialisé sans être re-semé. Plutôt que de le
 *  laisser sur un refus sec, on lui rappelle que la même démonstration s'ouvre
 *  sans compte.
 *
 *  Sert UNIQUEMENT à enrichir un échec de connexion : jamais à court-circuiter
 *  une réussite. La nuance est le tout de cette fonction — « 622001122 » est un
 *  numéro guinéen parfaitement plausible, et il peut appartenir à un vrai
 *  client. Si cette comparaison était faite AVANT l'appel à trust-api, ce
 *  client-là ne pourrait plus se connecter à son propre compte, et le bug
 *  serait bien pire que celui qu'on répare. L'appelant essaie donc la vraie
 *  connexion d'abord, et n'interroge cette fonction que sur le chemin d'erreur.
 *
 *  Le numéro est comparé sous forme canonique (normaliserMsisdnGn), pour que
 *  « 622 00 11 22 », « +224622001122 » et « 00224622001122 » soient reconnus :
 *  quelqu'un qui recopie un numéro depuis une capture d'écran l'espace comme il
 *  le lit. Un identifiant non téléphonique (le numéro OCAECG) retombe sur une
 *  comparaison de texte insensible à la casse. */
export function scenarioDemoPour(saisie: string): ScenarioDemo | null {
  const brut = saisie.trim();
  if (brut === "") {
    return null;
  }

  const msisdnSaisi = normaliserMsisdnGn(brut);

  return (
    SCENARIOS_DEMO.find((scenario) => {
      const msisdnScenario = normaliserMsisdnGn(scenario.identifiant);
      if (msisdnScenario !== null) {
        return msisdnSaisi !== null && msisdnSaisi === msisdnScenario;
      }
      return scenario.identifiant.toLowerCase() === brut.toLowerCase();
    }) ?? null
  );
}

/** Lecture défensive du paramètre d'URL qui simule l'état. Une valeur inconnue
 *  retombe sur `a_payer` — l'état ouvert est celui d'une facture normale, et
 *  c'est aussi celui qui montre le plus d'écran. */
export function statutCheckoutDepuisUrl(valeur: string | string[] | undefined): StatutCheckoutDemo {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur;
  return STATUTS_CHECKOUT_DEMO.includes(brut as StatutCheckoutDemo)
    ? (brut as StatutCheckoutDemo)
    : "a_payer";
}
