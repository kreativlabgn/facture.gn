// Paliers commerciaux (H1, ADR-074, ADR-106) — miroir de ce que trust-api
// APPLIQUE : plan-features-grid.ts pour les limites, commission-grid.ts pour
// les taux. La spec ci-contre confronte les deux fichiers ligne à ligne, pour
// qu'un écart entre ce qu'on affiche et ce qu'on facture soit impossible à
// livrer.
//
// LES TAUX VIENNENT DU CODE, PAS DE LA PLAQUETTE. La grille produit en
// circulation annonçait 1,6 / 1,1 / 0,8 / 0,6 % ; le code prélève 2,00 / 1,50 /
// 1,20 / 1,00 %. Elle datait d'avant la correction du frais Djomy (1,0 % →
// 1,4 %) et n'avait pas été mise à jour. Publier ses chiffres aurait promis un
// tarif que la plateforme ne pratique pas.
//
// LES PRIX, EUX, N'ONT AUCUNE SOURCE DANS LE CODE : aucun montant d'abonnement
// n'existe côté trust-api. Ceux ci-dessous viennent de la grille produit, seule
// source disponible — ils ne sont donc contrôlés par aucun test, contrairement
// aux taux et aux limites.

export const TIER_ORDER = [
  "freemium",
  "starter",
  "starter_plus",
  "pro",
  "enterprise",
  "custom",
] as const;

export type Tier = (typeof TIER_ORDER)[number];

export const TIER_LABELS: Record<Tier, string> = {
  freemium: "Freemium",
  starter: "Starter",
  starter_plus: "Starter Plus",
  pro: "Pro",
  enterprise: "Enterprise",
  custom: "Custom Volume",
};

/** Abonnement mensuel, en centimes GNF. Source : grille produit. */
export const PRIX_MENSUEL_CENTIMES: Record<Tier, string> = {
  freemium: "0",
  starter: "10000000",
  starter_plus: "25000000",
  pro: "50000000",
  enterprise: "75000000",
  custom: "150000000",
};

/** Commission plateforme en points de base — miroir de COMMISSION_BPS_BY_TIER. */
export const COMMISSION_BPS: Record<Tier, number> = {
  freemium: 210,
  starter: 200,
  starter_plus: 175,
  pro: 150,
  enterprise: 120,
  custom: 100,
};

/** Plafond de commission par encaissement, en centimes GNF — miroir de
 *  COMMISSION_CAP_CENTIMES_BY_TIER. C'est un argument commercial fort sur les
 *  gros montants : à 1,50 %, une facture de 50 M GNF serait facturée 750 000 —
 *  le plafond la ramène à 75 000. */
export const COMMISSION_CAP_CENTIMES: Record<Tier, string> = {
  freemium: "5000000",
  starter: "5000000",
  starter_plus: "5000000",
  pro: "7500000",
  enterprise: "10000000",
  custom: "15000000",
};

/** Frais de passerelle Djomy, en points de base (ADR-072, réel mesuré 1,4 %).
 *  Supporté par le PAYEUR, en plus de la commission plateforme. */
export const FRAIS_PASSERELLE_BPS = 140;

/** null = illimité. */
export const MAX_BRANCHES_BY_TIER: Record<Tier, number | null> = {
  freemium: 1,
  starter: 2,
  starter_plus: 5,
  pro: null,
  enterprise: null,
  custom: null,
};

export const MAX_MEMBERS_BY_TIER: Record<Tier, number | null> = {
  freemium: 1,
  starter: 4,
  starter_plus: 7,
  pro: 10,
  enterprise: null,
  custom: null,
};

// Rôles dont l'accès dépend du palier. Un rôle absent est disponible dès
// Freemium. starter_plus n'en ouvre aucun de plus que starter — « sophistication
// restreinte, hors API » selon la grille produit.
export const MIN_TIER_FOR_ROLE: Record<string, Tier> = {
  inventory_manager: "starter",
  approver: "pro",
  auditor: "pro",
  developer_api: "pro",
};

export const ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER: Tier = "pro";

/** Palier à partir duquel une clé X-PDP-API-Key peut être émise — miroir de
 *  PDP_GATEWAY_MIN_TIER (plan-features-grid.ts). Un SEUIL, jamais une liste de
 *  paliers autorisés : un palier ajouté au-dessus d'enterprise hériterait
 *  sinon silencieusement d'un refus. */
export const PDP_GATEWAY_MIN_TIER: Tier = "enterprise";

export function tierIndex(tier: string): number {
  return (TIER_ORDER as readonly string[]).indexOf(tier);
}

export function tierLabel(tier: string): string {
  return TIER_LABELS[tier as Tier] ?? tier;
}

/** Taux en pourcentage, à une ou deux décimales selon le besoin — « 1,75 % »,
 *  jamais « 1.75% » : la virgule décimale est la convention francophone. */
export function pourcentage(bps: number): string {
  const valeur = bps / 100;
  return `${valeur.toFixed(valeur % 1 === 0 ? 0 : 2).replace(".", ",")} %`;
}

/** Ce que supporte le payeur : commission plateforme + passerelle. */
export function totalPayeurBps(tier: Tier): number {
  return COMMISSION_BPS[tier] + FRAIS_PASSERELLE_BPS;
}

function limite(
  valeur: number | null,
  singulier: string,
  pluriel: string,
  illimite: string,
): string {
  if (valeur === null) return illimite;
  return `${valeur} ${valeur > 1 ? pluriel : singulier}`;
}

/** Ce que ce palier donne, formulé du point de vue du commerçant. Chaque ligne
 *  correspond à une limite RÉELLEMENT appliquée par trust-api. */
export function avantagesDuPalier(tier: Tier): string[] {
  const avantages = [
    limite(MAX_BRANCHES_BY_TIER[tier], "succursale", "succursales", "Succursales illimitées"),
    limite(
      MAX_MEMBERS_BY_TIER[tier],
      "membre d'équipe",
      "membres d'équipe",
      "Membres d'équipe illimités",
    ),
  ];

  const roles = Object.entries(MIN_TIER_FOR_ROLE)
    .filter(([, minimum]) => tierIndex(tier) >= tierIndex(minimum))
    .map(([role]) => ROLE_LABELS[role] ?? role);
  if (roles.length > 0) {
    avantages.push(`Rôles ${roles.join(", ")}`);
  }

  if (tierIndex(tier) >= tierIndex(ADVANCED_CUSTOMER_MANAGEMENT_MIN_TIER)) {
    avantages.push("Gestion client avancée — fusion de doublons, plafonds de crédit");
  }

  return avantages;
}

const ROLE_LABELS: Record<string, string> = {
  inventory_manager: "gestionnaire de stock",
  approver: "approbateur",
  auditor: "auditeur",
  developer_api: "développeur API",
};

// ── Ventilation des frais de transaction ────────────────────────────────────
//
// L'écran de paiement annonçait « Montant de la facture » + « Frais de
// paiement ». Le premier libellé était FAUX : InvoicesService.issue() transmet
// `totalTtc + platformFee` à money-api, donc la commission facture.gn était
// fondue dans le montant présenté comme celui de la marchandise. Le payeur
// voyait un prix, en réglait un autre.

export interface VentilationFrais {
  /** 100 % net pour le marchand — le prix de la marchandise, et rien d'autre. */
  marchandise: string;
  /** Commission facture.gn, selon le palier commercial du marchand. */
  infrastructure: string;
  /** Frais réseau de la passerelle Djomy. */
  passerelle: string;
  totalPayeur: string;
}

const BPS_DENOMINATEUR = BigInt(10000);

/** Miroir EXACT de computePlatformFee() (commission-grid.ts) puis du barème
 *  Djomy (djomy-stub.provider.ts) — division entière comprise, dans le même
 *  ordre. Une arrondi divergent ferait afficher un total que la passerelle ne
 *  prélèvera pas.
 *
 *  Montants en centimes GNF sérialisés en string (voir format.ts) : BigInt de
 *  bout en bout, jamais un number — au-delà de Number.MAX_SAFE_INTEGER, une
 *  facture perdrait des unités en silence. Aucun littéral `0n` : la cible de
 *  compilation de `web` est ES2017. */
export function ventilationFrais(montantCentimes: string, tier: Tier): VentilationFrais {
  const marchandise = BigInt(montantCentimes);

  // Un palier ajouté côté serveur avant d'être recopié ici retombe sur le
  // barème le plus DÉFAVORABLE au commerçant (freemium, 2,10 %), jamais sur le
  // plus favorable : mieux vaut annoncer un peu trop cher que promettre un
  // tarif qu'on ne pratique pas. Et jamais un écran de paiement qui plante.
  const bps = COMMISSION_BPS[tier] ?? COMMISSION_BPS.freemium;
  const plafond = BigInt(COMMISSION_CAP_CENTIMES[tier] ?? COMMISSION_CAP_CENTIMES.freemium);

  const commissionBrute = (marchandise * BigInt(bps)) / BPS_DENOMINATEUR;
  const infrastructure = commissionBrute > plafond ? plafond : commissionBrute;

  // EFFET DE CASCADE, documenté et sciemment accepté par commission-grid.ts :
  // Djomy facture ses 1,4 % sur le montant DÉJÀ majoré de notre commission
  // (`amountGnf` transmis à money-api = totalTtc + platformFee), jamais sur le
  // montant brut. Calculer la passerelle sur la seule marchandise
  // sous-estimerait ce que le payeur règle réellement.
  const passerelle = ((marchandise + infrastructure) * BigInt(FRAIS_PASSERELLE_BPS)) / BPS_DENOMINATEUR;

  return {
    marchandise: marchandise.toString(),
    infrastructure: infrastructure.toString(),
    passerelle: passerelle.toString(),
    totalPayeur: (marchandise + infrastructure + passerelle).toString(),
  };
}

// ── Frais de transaction, en UNE ligne ──────────────────────────────────────
//
// Deux lignes côte à côte — « facture.gn » puis « Djomy » — exposaient au payeur
// la répartition interne d'une somme qu'il débourse de toute façon. Le guichet
// n'en montre plus qu'une.
//
// Ce qui n'est PAS fusionné, c'est le calcul : `fraisTransaction` est la somme
// exacte des deux composantes de ventilationFrais(), cascade et plafond
// compris, jamais un pourcentage rond appliqué à la marchandise. Un taux écrit
// en dur — 2,5 %, par exemple — ne correspondrait à AUCUN palier (le barème
// donne 3,5 / 3,4 / 2,9 / 2,6 / 2,4 %) et rejouerait le bug que cet écran a
// précisément corrigé : un prix annoncé, un autre prélevé.

export interface FraisUnifies {
  /** 100 % net pour le marchand — le prix de la marchandise, et rien d'autre. */
  marchandise: string;
  /** Commission facture.gn + frais réseau de la passerelle, en un seul montant. */
  fraisTransaction: string;
  totalPayeur: string;
  /** Taux effectif en points de base, DÉRIVÉ des deux montants ci-dessus. */
  tauxEffectifBps: number;
}

/** Taux réellement supporté, déduit des montants — et jamais l'inverse.
 *
 *  Le plafond de commission rend ce taux dégressif : passé le plafond du
 *  palier, chaque franc supplémentaire ne porte plus que la passerelle. Un taux
 *  nominal recopié du barème mentirait exactement là où l'argument commercial
 *  est le plus fort — sur les grosses factures.
 *
 *  Arrondi au point de base le plus proche : `+½ bps` avant la division
 *  entière, en BigInt de bout en bout. Une marchandise nulle n'a pas de taux —
 *  on rend 0 plutôt que de diviser par zéro. Aucun littéral `0n` : la cible de
 *  compilation de `web` est ES2017. */
export function tauxEffectifBps(marchandiseCentimes: string, fraisCentimes: string): number {
  const marchandise = BigInt(marchandiseCentimes);
  if (marchandise <= BigInt(0)) return 0;

  const frais = BigInt(fraisCentimes);
  const deuxFoisMarchandise = marchandise * BigInt(2);
  return Number((frais * BPS_DENOMINATEUR * BigInt(2) + marchandise) / deuxFoisMarchandise);
}

/** Vue fusionnée de ventilationFrais() : deux lignes deviennent une, le total
 *  reste au centime ce qu'il était. */
export function fraisTransaction(montantCentimes: string, tier: Tier): FraisUnifies {
  const v = ventilationFrais(montantCentimes, tier);
  const frais = (BigInt(v.infrastructure) + BigInt(v.passerelle)).toString();

  return {
    marchandise: v.marchandise,
    fraisTransaction: frais,
    totalPayeur: v.totalPayeur,
    tauxEffectifBps: tauxEffectifBps(v.marchandise, frais),
  };
}

// ── Prédicats de palier consommés par les onglets Paramètres ────────────────

export function passerelleePdpAutorisee(tier: Tier): boolean {
  return tierIndex(tier) >= tierIndex(PDP_GATEWAY_MIN_TIER);
}

/** null = illimité. */
export function quotaSuccursales(tier: Tier): number | null {
  return MAX_BRANCHES_BY_TIER[tier] ?? null;
}

export function quotaMembres(tier: Tier): number | null {
  return MAX_MEMBERS_BY_TIER[tier] ?? null;
}

/** `limite === null` veut dire ILLIMITÉ, et c'est exactement le piège d'une
 *  comparaison naïve : en JavaScript `0 >= null` vaut `true`, ce qui bloquerait
 *  la création dès la première ligne sur un palier sans plafond. Le cas nul est
 *  donc traité en premier, jamais par la comparaison. */
export function quotaAtteint(utilises: number, limite: number | null): boolean {
  if (limite === null) return false;
  return utilises >= limite;
}
