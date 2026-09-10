import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { CertificationLookupForm } from "@/components/CertificationLookupForm";
import {
  CloisonsEtanches,
  CourbeEncaissements,
  FluxCapital,
  SceauCertification,
} from "@/components/Illustrations";
import { formatGnf } from "@/lib/format";
import { PLAFOND_DEMO_CENTIMES, portefeuilleDemo } from "@/lib/demo-accounts";
import { COMMISSION_CAP_CENTIMES, fraisTransaction, pourcentage } from "@/lib/plans";

// Page d'accueil publique. L'en-tête, la navigation et le pied de page vivent
// dans `(marketing)/layout.tsx` ; ce fichier ne porte que le discours.
//
// ── LA RÈGLE D'ÉCRITURE DE CETTE PAGE ────────────────────────────────────────
// Le corps de la page nomme chaque mécanisme par ce qu'il FAIT pour le lecteur,
// jamais par la façon dont il est construit : un commerçant de Madina n'achète
// pas une primitive cryptographique, il achète de ne plus perdre ses preuves.
//
// TROIS EXCEPTIONS, ET ELLES SONT DÉLIBÉRÉES (arbitrage Product Marketing) —
// « Ed25519 », « FORCE ROW LEVEL SECURITY » et le schéma du connecteur. Ce ne
// sont pas des décorations techniques : ce sont les trois endroits où le
// lecteur visé est justement celui qui SAIT lire le terme — un comptable qui
// compare deux plateformes, un DSI qui instruit un dossier, un intégrateur qui
// branche un ERP. Chacun est posé À CÔTÉ de sa formulation en clair, jamais à
// la place : le terme sert de preuve à qui le reconnaît, la phrase sert de sens
// à tous les autres. Un jargon qui remplacerait la phrase, lui, resterait ce
// qu'il était au premier jet — du vocabulaire d'architecte affiché en vitrine.
//
// ── CE QUE CETTE PAGE NE DIT PAS ─────────────────────────────────────────────
// Jamais « officiel », jamais « national », jamais « registre » : facture.gn
// est un tiers de confiance PRIVÉ certifié, pas une administration ni un
// registre d'État (positionnement non négociable, CLAUDE.md). Le premier jet
// écrivait « registre d'immuabilité national » et « code court sécurisé
// national » — deux revendications d'autorité publique qu'une société privée
// ne peut pas porter. La conformité se dit par la Loi de Finances, qui est un
// fait ; l'autorité se dit par « certifiée », qui en est un aussi.
//
// ── LES CHIFFRES VIENNENT DU CODE ────────────────────────────────────────────
// Taux et plafonds sont IMPORTÉS de lib/plans.ts, jamais recopiés en dur dans
// une phrase. Ce fichier porte la cicatrice de l'épisode où la plaquette
// annonçait 1,1 % pendant que le code prélevait 1,50 %. Une landing qui répète
// un chiffre à la main rouvre exactement cette faille : ici, un taux qui change
// côté serveur change la page au prochain build, ou casse le typage.
//
// ── STYLE ────────────────────────────────────────────────────────────────────
// Tokens du Design System (globals.css) uniquement : aucune couleur en dur,
// sous peine d'échec du garde-fou `design-system.guardrails.spec.ts` en CI.
//   R-01  jamais de dégradé, et jamais les couleurs du drapeau guinéen.
//   R-11  jamais de texte clair sur l'Or (1.8:1). L'Or porte du Navy (9.4:1).
//   AA    l'échelle Navy sous navy-600 est faite pour les bordures, jamais
//         pour du texte.
// Les bordures douces demandées (`slate-200/60`) sont rendues par `navy-100` —
// le token du système qui vaut déjà un gris tendre (navy à 12 %). Ajouter une
// échelle `slate` dupliquerait la palette pour la même valeur à l'œil.

export const metadata: Metadata = {
  title: "facture.gn — Facturation certifiée pour les entreprises guinéennes",
  description:
    "Sécurisez votre comptabilité, libérez votre trésorerie, sans changer d'habitudes. Certification instantanée, encaissement unifié et avance sur créance — en conformité avec la Loi de Finances 2025.",
};

// Facture d'exemple servant la démonstration tarifaire : 1 000 000 GNF, exprimé
// en centimes comme partout ailleurs dans le code. Le palier gratuit est celui
// du lecteur qui découvre la page.
const EXEMPLE = fraisTransaction("100000000", "freemium");

// Seconde facture d'exemple, DIX FOIS plus grosse — et c'est tout l'intérêt :
// elle dépasse le plafond de commission du palier, donc son taux effectif
// décroche du barème. Sans elle, la page annoncerait un taux unique là où le
// code en pratique un dégressif, et le plafond — l'argument le plus fort du
// palier gratuit sur les gros montants — resterait invisible.
const EXEMPLE_GROS_MONTANT = fraisTransaction("1000000000", "freemium");

// Le portefeuille du scénario marchand (14 factures, 45 000 000 GNF), tarifé
// facture PAR facture par le code du guichet. C'est le seul moyen honnête de
// citer un taux MOYEN : le plafond de commission joue par encaissement, donc
// appliquer un pourcentage au volume annuel donnerait un chiffre flatteur et
// faux. Huit factures sur quatorze plafonnent ici — d'où un taux réel qui
// décroche nettement sous le barème, et qui est l'argument du palier gratuit.
//
// La landing lit le MÊME objet que /demo/marchand : la page publique et l'écran
// de démonstration ne peuvent pas annoncer deux taux différents.
const PORTEFEUILLE_TYPE = portefeuilleDemo();

const TRAIT = { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.75 } as const;

// ── Tracés SVG en ligne ──────────────────────────────────────────────────────
// Aucune fonte d'icônes tierce dans ce dépôt, et rien ici ne justifie d'en
// introduire une : `currentColor` fait suivre chaque glyphe à la couleur de son
// conteneur, ce qu'une police d'icônes rend précisément plus difficile.
function IconeCoche() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="mt-[3px] h-3.5 w-3.5 shrink-0">
      <path {...TRAIT} d="m3 8.4 3.2 3.1L13 4.5" />
    </svg>
  );
}

function IconeDepot() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path {...TRAIT} d="M12 3.5v11M8 11l4 3.5 4-3.5" />
      <path {...TRAIT} d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function IconeApprobation() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path
        {...TRAIT}
        d="M20 11.2V6.4a1.4 1.4 0 0 0-.9-1.3l-6.6-2.5a1.4 1.4 0 0 0-1 0L4.9 5.1A1.4 1.4 0 0 0 4 6.4v5.4c0 4.4 3.4 7.9 8 9.4"
      />
      <path {...TRAIT} d="m14 16 2 2 4.5-4.5" />
    </svg>
  );
}

function IconeLitige() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path {...TRAIT} d="M12 3.8 21 19.5H3z" />
      <path {...TRAIT} d="M12 9.8v4.1M12 17.1h.01" />
    </svg>
  );
}

function IconeEncaissement() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path
        {...TRAIT}
        d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5z"
      />
      <path {...TRAIT} d="M14.2 12a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0ZM6.2 9.5v5M17.8 9.5v5" />
    </svg>
  );
}

// Fronton à colonnes — l'acheteur public et la banque. Volontairement sobre :
// c'est un bâtiment institutionnel générique, jamais un emblème d'État, que
// facture.gn n'a pas le droit d'arborer (tiers de confiance PRIVÉ certifié).
function IconeInstitution() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path {...TRAIT} d="m12 3 8.5 4.2H3.5z" />
      <path {...TRAIT} d="M6 10.2v6.6M10 10.2v6.6M14 10.2v6.6M18 10.2v6.6" />
      <path {...TRAIT} d="M3.8 20.4h16.4" />
    </svg>
  );
}

// Bouclier fermé par une serrure : le verrou anti-double-nantissement. Distinct
// d'IconeApprobation (bouclier + coche), qui dit « reconnu », là où celui-ci dit
// « fermé » — deux idées voisines qui ne doivent pas partager un glyphe.
function IconeVerrou() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path
        {...TRAIT}
        d="M20 11.2V6.4a1.4 1.4 0 0 0-.9-1.3l-6.6-2.5a1.4 1.4 0 0 0-1 0L4.9 5.1A1.4 1.4 0 0 0 4 6.4v5.4c0 4.4 3.4 7.9 8 9.4"
      />
      <path {...TRAIT} d="M15.2 14.4h5.3v4.4h-5.3zM16.4 14.4v-1.5a1.45 1.45 0 0 1 2.9 0v1.5" />
    </svg>
  );
}

function IconeTelephone() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
      <path
        {...TRAIT}
        d="M7.6 2.8h8.8a1.7 1.7 0 0 1 1.7 1.7v15a1.7 1.7 0 0 1-1.7 1.7H7.6a1.7 1.7 0 0 1-1.7-1.7v-15a1.7 1.7 0 0 1 1.7-1.7Z"
      />
      <path {...TRAIT} d="M12 18.2h.01" />
    </svg>
  );
}

// ── Les quatre statuts, dits comme on les raconte ────────────────────────────
// Miroir d'affichage de lib/invoice-lifecycle.ts, qui reste la source unique :
// quatre colonnes ORTHOGONALES, écrites par quatre acteurs différents. C'est ce
// qui permet à un cabinet d'intercepter une contestation sur une facture par
// ailleurs déposée, approuvée ET encaissée — la situation qui appelle le plus
// une décision, et que tout badge « le plus avancé » masquerait.
//
// Les libellés techniques du parcours (numéro de reçu eTax, ordonnateur,
// liquidation) sont remplacés par leur effet concret. Le statut, lui, ne change
// pas en base.
const STATUTS = [
  {
    cle: "Déposée",
    ecrivain: "Automatique",
    texte:
      "La facture est enregistrée auprès de l’administration fiscale. Ni vous ni votre client n’avez à y penser.",
    icone: <IconeDepot />,
  },
  {
    cle: "Approuvée",
    ecrivain: "Le client",
    texte: "Le client reconnaît la prestation. C’est ce qui rend la facture finançable.",
    icone: <IconeApprobation />,
  },
  {
    cle: "En litige",
    ecrivain: "Le client",
    texte:
      "Le client conteste. Le seul statut qui attend une action — et le seul qui laisse encore corriger.",
    icone: <IconeLitige />,
  },
  {
    cle: "Encaissée",
    ecrivain: "Le paiement",
    texte:
      "L’argent est arrivé. Indépendant des trois autres : une facture payée peut rester contestée.",
    icone: <IconeEncaissement />,
  },
];

// Quatre garanties, dites par ce qu'elles empêchent — pas par la primitive
// cryptographique qui les produit. Le premier jet titrait « Chaînage »,
// « Ancrage périodique » et « Cloisonnement en base » : exact, et illisible.
const GARANTIES = [
  {
    titre: "Rien ne se retire en douce",
    texte:
      "Chaque facture scelle la précédente. Retirer ou modifier une pièce après coup casse la suite, et la cassure se voit de l’extérieur.",
  },
  {
    titre: "Personne ne signe à votre place",
    texte:
      "Votre entreprise a sa propre signature. Aucune autre société ne peut émettre en votre nom — nous non plus.",
  },
  {
    titre: "La date fait foi",
    texte:
      "L’antériorité de vos factures s’établit sans avoir à nous croire sur parole. Elle est vérifiable même contre nous.",
  },
  {
    titre: "Vos données ne croisent personne",
    texte:
      "L’isolation entre entreprises est appliquée par la base de données elle-même, sous chaque requête — pas seulement par l’application au-dessus.",
  },
];

// ── FAQ INSTITUTIONNELLE ────────────────────────────────────────────────────
// Cinq questions, choisies parce que ce sont celles qui font ABANDONNER — les
// trois premières côté marchand (qui voit mes chiffres, que se passe-t-il quand
// ça se passe mal, combien ça coûte vraiment), les deux dernières côté
// institution (mes deux canaux racontent-ils la même chose, et qu'arrive-t-il à
// une synthèse de caisse dans mes comptes). Une FAQ qui répond à autre chose
// est une FAQ décorative.
//
// Les réponses sont volontairement longues et sans échappatoire. La troisième
// donne les DEUX taux — celui du barème et celui, plus bas, qu'un gros montant
// supporte réellement — parce qu'une page qui n'annoncerait que le premier
// laisserait croire à un tarif linéaire que le code ne pratique pas.
//
// Les deux dernières décrivent des mécanismes qui TOURNENT (coexistence des
// canaux, apurement automatique des synthèses de caisse). Elles sont écrites
// au présent parce qu'elles sont vraies au présent : une FAQ qui annonce une
// feuille de route au présent est le premier endroit où une plateforme perd un
// acheteur public.
const FAQ: { question: string; reponse: React.ReactNode }[] = [
  {
    question: "Qui peut voir mes factures et mes chiffres d’affaires ?",
    reponse: (
      <>
        <p>
          Personne d’autre que vous, et les personnes à qui vous avez ouvert la porte : vos
          collaborateurs, et le cabinet à qui vous avez accordé un mandat — un mandat que vous
          révoquez quand vous voulez, sans nous le demander.
        </p>
        <p>
          La séparation entre entreprises n’est pas une consigne donnée à l’application : elle est
          posée dans la base de données elle-même, en <em>FORCE ROW LEVEL SECURITY</em>, et
          s’applique jusqu’au propriétaire des tables. Une requête mal filtrée ne renvoie pas les
          lignes d’une autre société : elle ne renvoie rien.
        </p>
        <p>
          facture.gn est un tiers de confiance <strong>privé</strong> certifié, pas un registre
          d’État. Nous conservons de quoi prouver qu’une facture existait, à sa date et pour son
          montant — pas de quoi renseigner un tiers sur votre activité.
        </p>
      </>
    ),
  },
  {
    question: "Que se passe-t-il si mon client conteste une facture ?",
    reponse: (
      <>
        <p>
          Il la marque « en litige », et vous le voyez immédiatement, avec le motif écrit. Le statut
          n’efface rien : la facture reste déposée, et si elle a été réglée, elle reste encaissée.
          Les quatre états coexistent, parce qu’une facture payée peut parfaitement rester
          contestée.
        </p>
        <p>
          Tant que l’exercice n’est pas clos, une contestation reste réparable : vous corrigez,
          vous émettez un avoir, et l’affaire se règle entre vous. Le même incident découvert après
          la clôture ne se corrige plus — il se conteste. C’est pourquoi « en litige » est une
          chance, pas une alarme : c’est le signal qui arrive encore à temps.
        </p>
        <p>
          Ce qui ne bouge pas, c’est la pièce elle-même : une facture certifiée ne se modifie pas
          après coup. La correction est une NOUVELLE pièce, qui pointe la première — les deux
          restent, et l’historique reste lisible.
        </p>
      </>
    ),
  },
  {
    question: "Combien cela me coûte-t-il réellement ?",
    reponse: (
      <>
        <p>
          Rien à l’émission, et rien sur une facture qui n’est jamais réglée. Les frais ne sont
          prélevés qu’à l’encaissement, en <strong>une seule ligne</strong> annoncée avant le
          paiement — commission facture.gn et frais du réseau Mobile Money compris.
        </p>
        <p>
          Sur le palier gratuit, une facture de {formatGnf(EXEMPLE.marchandise)} supporte{" "}
          {formatGnf(EXEMPLE.fraisTransaction)}, soit {pourcentage(EXEMPLE.tauxEffectifBps)}.
        </p>
        <p>
          Mais la commission est <strong>plafonnée à {formatGnf(COMMISSION_CAP_CENTIMES.freemium)}{" "}
          par encaissement</strong>, ce qui rend le taux dégressif : la même facture à{" "}
          {formatGnf(EXEMPLE_GROS_MONTANT.marchandise)} ne supporte que{" "}
          {formatGnf(EXEMPLE_GROS_MONTANT.fraisTransaction)} —{" "}
          {pourcentage(EXEMPLE_GROS_MONTANT.tauxEffectifBps)}. Plus la facture est grosse, plus le
          taux réel descend sous le barème.
        </p>
        <p>
          Ces deux chiffres sont calculés par le même code que l’écran de paiement : ce que vous
          lisez ici est ce qui sera prélevé, au franc près.
        </p>
      </>
    ),
  },
  {
    question: "J’émets depuis *620#. Est-ce la même facture que sur le web ?",
    reponse: (
      <>
        <p>
          C’est la même pièce, dans le même compte, avec le même numéro de reçu fiscal derrière.
          Le code court n’est pas un produit à part ni un mode dégradé : c’est une porte d’entrée
          de plus sur le même dossier. Une facture composée au comptoir sur un téléphone à touches
          apparaît sur le tableau de bord web, part au guichet e-TVA et sort dans l’export
          comptable exactement comme celle qui a été saisie au clavier.
        </p>
        <p>
          Les deux canaux <strong>coexistent</strong> — il n’y a jamais à choisir, ni à migrer de
          l’un vers l’autre. Un commerçant qui facture toute la semaine en USSD et qui ouvre le web
          le samedi pour éditer ses relevés ne retrouve pas deux comptabilités : il en retrouve
          une.
        </p>
        <p>
          Ce que l’USSD ne fait pas, il ne le simule pas : pas de catalogue produits, pas de pièce
          jointe, pas de multi-lignes détaillées. Le canal court sert ce qu’un écran de six lignes
          peut servir honnêtement — encaisser, certifier, consulter.
        </p>
      </>
    ),
  },
  {
    question: "Que deviennent mes ventes au comptant dans les comptes ?",
    reponse: (
      <>
        <p>
          Elles sont regroupées en une synthèse de caisse quotidienne — le « Z » de fin de journée
          — transmise au titre de l’e-Reporting comme n’importe quelle autre pièce. Le détail
          ticket par ticket ne part pas à l’administration ; le total de la journée, lui, oui.
        </p>
        <p>
          Une synthèse de caisse n’est pas une créance : l’argent est déjà dans le tiroir. Sans
          traitement, elle resterait indéfiniment « en attente de règlement » et gonflerait votre
          encours client d’un montant déjà encaissé — un faux impayé, tous les jours, qui fausserait
          aussi bien votre pilotage que le dossier de crédit que vous montrez à une banque.
        </p>
        <p>
          Elle est donc <strong>apurée automatiquement à zéro</strong>, au comptant, dès son
          émission : le règlement est écrit au journal de caisse, la balance retombe à zéro, et
          aucun lien de paiement n’est envoyé pour une somme déjà perçue. Ces règlements-là sont
          exclus du ratio d’encaissements par lien de paiement — sans quoi un commerçant honnête
          verrait son propre indicateur s’effondrer, une fois par jour, à cause de ses ventes au
          comptoir.
        </p>
      </>
    ),
  },
];

// Extrait FIDÈLE de createPdpInvoiceSchema (apps/trust-api/src/pdp/dto/
// create-pdp-invoice.dto.ts) : les noms de champs, les types et les bornes sont
// ceux que le serveur applique réellement. Un connecteur écrit sur la foi de ce
// bloc doit passer du premier coup — c'est la seule raison d'afficher du code
// sur une page publique, et la seule zone de jargon assumée.
const SCHEMA_CONNECTEUR = [
  "POST /pdp/invoices     X-PDP-API-Key: <clé de l'organisation>",
  "",
  "createPdpInvoiceSchema = z.object({",
  "  clientUniqueId:  z.string().min(1).max(128),  // clé d'idempotence",
  '  transactionType: z.enum(["b2b", "b2g", "b2c"]),',
  '  totalHT:         montantGnf,       // "1000000" — GNF, pas de centimes',
  "  totalVAT:        montantGnf,       // totalTTC est DÉRIVÉ, jamais reçu",
  "  issueDate:       z.coerce.date(),",
  "  customer:        { name, nif?, address? }.optional(),",
  "  lines:           [{ description, quantity, unitPrice }].min(1).optional(),",
  "  referenceMarche, numeroBonCommande,           // marchés publics",
  "  numeroContrat,   numeroEngagement,",
  "})",
].join("\n");

const REGLES_CONNECTEUR = [
  "Aucun identifiant d’organisation dans le corps : il vient de la clé, jamais d’un champ que l’appelant contrôle.",
  "Le total hors taxes doit être exactement la somme des lignes — aucune remise globale sur ce chemin.",
  "Le détail des lignes est obligatoire entre entreprises et vers le secteur public (OHADA, article 23).",
  "Le même identifiant rejoué rend le document déjà certifié, jamais un doublon.",
];

export default function LandingPage() {
  return (
    <>
      {/* ─── Hero ────────────────────────────────────────────────────────── */}
      {/* Une promesse, trois verbes, aucun sigle. La respiration verticale fait
          le travail que faisaient les aplats : c'est le blanc qui donne le
          poids, pas la couleur. */}
      <section className="border-b border-navy-100 bg-white py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Deux colonnes sur grand écran, UNE seule sur téléphone — et dans
              cet ordre : le discours d'abord, l'illustration ensuite. Un
              visuel qui pousse le titre sous la ligne de flottaison sur un
              écran de 360 px fait payer le décor par le message. */}
          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
            <div className="max-w-3xl">
              <p className="mb-8 inline-flex items-center gap-2 rounded-full border border-navy-100 bg-grey px-3 py-1 text-xs font-semibold text-navy-600">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-or" />
                En conformité avec la Loi de Finances 2025
              </p>
              {/* Deux phrases, et la seconde fait tout le travail. « Certifiée
                  partout » est la promesse ; « du comptoir à la direction
                  financière » est la PREUVE que la promesse tient sur toute
                  l'amplitude du marché — le même document, écrit par un
                  commerçant sur un téléphone à touches, lu par un DAF qui
                  instruit un mandatement. Un titre qui ne nommerait qu'un bout
                  de cette amplitude laisserait l'autre public croire que la
                  plateforme n'est pas pour lui. */}
              <h1 className="mb-6 font-display text-4xl leading-[1.08] font-bold tracking-tight text-navy-950 sm:text-5xl lg:text-6xl">
                La facture guinéenne, certifiée partout. Du comptoir à la direction financière.
              </h1>
              {/* Le sous-titre unifie les TROIS portes d'entrée en une seule
                  phrase, parce que c'est exactement ce qui n'est pas évident :
                  qu'un code composé sur un téléphone sans écran et un flux
                  poussé par un ERP produisent la MÊME pièce, avec le même
                  numéro de reçu fiscal derrière. */}
              <p className="mb-8 max-w-2xl text-lg leading-relaxed text-navy-600 sm:text-xl">
                Composée sur <span className="font-mono font-bold text-navy-950">*620#</span> depuis
                un téléphone sans internet, poussée par votre ERP (Odoo, SAP) ou saisie ici : c’est
                la même facture qui ressort — scellée à l’émission, télétransmise au guichet e-TVA
                (SAFIG&nbsp;2) exigé par la Loi de Finances 2025, et payable en une seule ligne de
                frais.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/inscription" variant="accent" size="lg">
                  Créer mon compte
                </ButtonLink>
                {/* La démonstration est une porte de PREMIER rang, pas un lien
                    de bas de page : un acheteur institutionnel ne crée pas de
                    compte pour voir un écran, il veut l'écran d'abord. */}
                <ButtonLink href="/demo" variant="secondary" size="lg">
                  Voir une démonstration
                </ButtonLink>
                <ButtonLink href="#verify" variant="secondary" size="lg">
                  Vérifier une facture
                </ButtonLink>
              </div>
            </div>

            {/* Le panneau de droite n'est pas un ornement : il montre les deux
                choses que la page promet — une pièce scellée, et une courbe
                d'encaissements qui monte. Les chiffres qui l'accompagnent sont
                ceux du barème réel, pas des nombres de maquette. */}
            <div className="rounded-2xl border border-navy-100 bg-grey p-6 sm:p-8">
              <div className="flex items-center gap-5">
                <SceauCertification className="h-20 w-20 shrink-0 sm:h-24 sm:w-24" />
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
                    Signé · Ed25519
                  </p>
                  <p className="mt-1 font-display text-lg font-semibold text-navy-950">
                    Scellée à la seconde de l’émission
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-navy-600">
                    Et chaînée à la précédente : on ne retire pas une pièce d’une suite sans que la
                    cassure se voie.
                  </p>
                </div>
              </div>

              <div className="mt-6 rounded-xl border border-navy-100 bg-white p-5">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <p className="text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                    Encaissements
                  </p>
                  <p className="font-mono text-sm font-bold text-navy-950">
                    {pourcentage(EXEMPLE.tauxEffectifBps)}
                  </p>
                </div>
                <CourbeEncaissements points={[18, 24, 21, 33, 29, 41, 38, 52, 47, 61, 58, 74]} />
                <p className="mt-3 text-xs leading-relaxed text-navy-600">
                  Frais de transaction sur une facture de {formatGnf(EXEMPLE.marchandise)} :{" "}
                  {formatGnf(EXEMPLE.fraisTransaction)}. Plafonnés à{" "}
                  {formatGnf(COMMISSION_CAP_CENTIMES.freemium)} par encaissement.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Les trois piliers ───────────────────────────────────────────── */}
      {/* La page entière tient dans ces trois cartes : ce qu'on scelle, ce
          qu'on encaisse, ce qu'on avance. Tout ce qui suit les développe. Le
          reste de la landing pourrait disparaître sans que la proposition de
          valeur soit perdue — c'est le test qu'une section « piliers » doit
          passer pour mériter sa place en deuxième écran. */}
      <section id="piliers" className="scroll-mt-24 border-b border-navy-100 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
              Trois couches, une seule facture
            </p>
            <h2 className="mb-5 font-display text-3xl leading-tight font-bold tracking-tight text-navy-950 sm:text-4xl">
              Ce que la plateforme fait de chaque pièce que vous émettez.
            </h2>
            <p className="text-lg leading-relaxed text-navy-600">
              Elles s’enchaînent sur le même document, sans double saisie et sans second logiciel.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* 1 — Certification */}
            <article className="flex flex-col rounded-2xl border border-navy-100 bg-white p-8">
              <span
                aria-hidden="true"
                className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-navy-100 text-navy-950"
              >
                <IconeApprobation />
              </span>
              <p className="mb-2 font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
                Pilier 1 — Trust
              </p>
              <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                Certification instantanée
              </h3>
              <p className="mb-6 text-sm leading-relaxed text-navy-600">
                Chaque facture reçoit une signature qui lui est propre au moment où vous l’émettez,
                puis scelle la précédente. Le même document rejoué ne crée pas de doublon : il rend
                la pièce déjà certifiée.
              </p>
              <ul className="mt-auto flex flex-col gap-2.5">
                {[
                  "Signature unitaire Ed25519, une par facture",
                  "Chaînage : retirer une pièce casse la suite, et ça se voit",
                  "Anti-doublon sur l’identifiant que vous fournissez",
                ].map((point) => (
                  <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-navy-600">
                    <span aria-hidden="true" className="text-navy-950">
                      <IconeCoche />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </article>

            {/* 2 — Encaissement. La carte porte la ligne de frais telle qu'elle
                s'affichera au guichet : même calcul, même arrondi, même
                libellé. Un prix promis ici et démenti au paiement est
                exactement le bug que cette ligne unique a corrigé. */}
            <article className="flex flex-col rounded-2xl border border-navy-100 bg-white p-8">
              <span
                aria-hidden="true"
                className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-navy-100 text-navy-950"
              >
                <IconeEncaissement />
              </span>
              <p className="mb-2 font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
                Pilier 2 — Money
              </p>
              <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                Encaissement unifié
              </h3>
              <p className="mb-6 text-sm leading-relaxed text-navy-600">
                Orange Money et MTN MoMo sur le même lien. Le payeur voit UNE ligne de frais cumulée
                — commission et frais réseau fondus — et c’est cette somme-là qu’il règle.
              </p>
              <dl className="mt-auto flex flex-col gap-3 rounded-xl border border-navy-100 bg-grey p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-navy-600">Marchandise</dt>
                  <dd className="font-mono text-sm font-bold text-navy-950">
                    {formatGnf(EXEMPLE.marchandise)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-navy-600">
                    Frais de transaction ({pourcentage(EXEMPLE.tauxEffectifBps)})
                  </dt>
                  <dd className="font-mono text-sm font-bold text-navy-950">
                    {formatGnf(EXEMPLE.fraisTransaction)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-navy-100 pt-3">
                  <dt className="text-sm text-navy-600">Le client règle</dt>
                  <dd className="font-mono text-sm font-bold text-navy-950">
                    {formatGnf(EXEMPLE.totalPayeur)}
                  </dd>
                </div>
              </dl>
            </article>

            {/* 3 — Capital. Seule carte Navy de la rangée : c'est la couche qui
                fait sortir de l'argent, et la seule dont l'exécution ne
                dépend pas que de nous. */}
            <article className="flex flex-col rounded-2xl border border-navy-800 bg-navy-950 p-8 text-white">
              <span
                aria-hidden="true"
                className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 text-or"
              >
                <IconeDepot />
              </span>
              <p className="mb-2 font-mono text-[11px] font-bold tracking-wide text-or uppercase">
                Pilier 3 — Capital Layer
              </p>
              <h3 className="mb-3 font-display text-xl font-semibold">Trésorerie sous 24 h</h3>
              <p className="mb-6 text-sm leading-relaxed text-white/75">
                Dès que votre client — administration comprise — a reconnu le service fait, la
                créance devient finançable. Akiba Finance et les autres établissements agréés BCRG
                la rachètent sans attendre l’échéance.
              </p>
              <div className="mt-auto">
                <FluxCapital ton="sombre" />
                <p className="mt-2 text-xs leading-relaxed text-white/75">
                  facture.gn établit l’éligibilité, la rend opposable et verrouille la créance
                  contre une seconde cession. Le versement et ses conditions se règlent entre
                  l’établissement et votre entreprise.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ─── Segment PME ─────────────────────────────────────────────────── */}
      {/* Deux arguments, pas dix : on facture en tapant un numéro de téléphone,
          et émettre ne coûte rien. Le reste de l'ancienne section était du
          détail de fonctionnalité. */}
      <section id="pme" className="scroll-mt-24 border-b border-navy-100 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
              Commerces, PME et associations
            </p>
            <h2 className="mb-5 font-display text-3xl leading-tight font-bold tracking-tight text-navy-950 sm:text-4xl">
              Un numéro de téléphone suffit à facturer.
            </h2>
            <p className="text-lg leading-relaxed text-navy-600">
              Au comptoir, vous tapez le numéro du client. Pas de fiche à créer, pas de formulaire à
              remplir avant d’encaisser.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <article className="flex flex-col rounded-2xl border border-navy-100 bg-white p-8">
              <span
                aria-hidden="true"
                className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-navy-100 text-navy-950"
              >
                <IconeEncaissement />
              </span>
              <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                Illimité, et gratuit
              </h3>
              <p className="mb-6 text-sm leading-relaxed text-navy-600">
                Émettez autant de factures que votre activité l’exige. Aucun quota de volume, aucune
                carte bancaire pour commencer.
              </p>
              <ul className="mt-auto flex flex-col gap-2.5">
                {[
                  "Factures certifiées sans limite de nombre",
                  "Catalogue produits et suivi de stock",
                  "Pensé d’abord pour le téléphone",
                ].map((point) => (
                  <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-navy-600">
                    <span aria-hidden="true" className="text-navy-950">
                      <IconeCoche />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </article>

            {/* Le tarif, en une ligne — la même qu'au guichet de paiement.
                Détailler commission et passerelle séparément donnait à un prix
                simple un air de négociation : le lecteur veut savoir ce qu'il
                lui reste, pas comment on se répartit la somme. */}
            <article className="flex flex-col rounded-2xl border border-navy-100 bg-white p-8">
              <span
                aria-hidden="true"
                className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-navy-100 text-navy-950"
              >
                <IconeApprobation />
              </span>
              <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                Vous ne payez qu’à l’encaissement
              </h3>
              <p className="mb-6 text-sm leading-relaxed text-navy-600">
                Rien n’est prélevé sur une facture émise mais non réglée. Quand le paiement arrive,
                des frais de transaction uniques s’appliquent, plafonnés à{" "}
                {formatGnf(COMMISSION_CAP_CENTIMES.freemium)}.
              </p>
              {/* Chasse fixe : ce sont des données financières arrêtées, le cas
                  où la charte réclame le mono. */}
              <dl className="mt-auto flex flex-col gap-3 rounded-xl border border-navy-100 bg-grey p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-navy-600">Vous facturez</dt>
                  <dd className="font-mono text-sm font-bold text-navy-950">
                    {formatGnf(EXEMPLE.marchandise)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-navy-600">
                    Frais de transaction ({pourcentage(EXEMPLE.tauxEffectifBps)})
                  </dt>
                  <dd className="font-mono text-sm font-bold text-navy-950">
                    {formatGnf(EXEMPLE.fraisTransaction)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-navy-100 pt-3">
                  <dt className="text-sm text-navy-600">Le client règle</dt>
                  <dd className="font-mono text-sm font-bold text-navy-950">
                    {formatGnf(EXEMPLE.totalPayeur)}
                  </dd>
                </div>
              </dl>
            </article>

            {/* Canal hors-ligne — seule carte en Navy plein de cette rangée :
                c'est le canal qui n'a pas d'équivalent chez les autres, et le
                contraste de surface suffit à le distinguer sans ombre. */}
            <article className="flex flex-col rounded-2xl border border-navy-800 bg-navy-950 p-8 text-white">
              <span
                aria-hidden="true"
                className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 text-or"
              >
                <IconeTelephone />
              </span>
              <h3 className="mb-3 font-display text-xl font-semibold">Même sans internet</h3>
              <p className="mb-6 text-sm leading-relaxed text-white/75">
                Zéro connexion, zéro smartphone. Certifiez et encaissez depuis n’importe quel
                téléphone, en composant un code court.
              </p>
              {/* Chasse fixe : c'est un code à composer chiffre par chiffre,
                  exactement le cas où la charte réclame le mono pour lever
                  l'ambiguïté 0/O et 1/l. */}
              <div className="mt-auto rounded-xl border border-navy-800 bg-white/5 p-5 text-center">
                <span className="mb-1 block font-mono text-2xl font-bold tracking-widest text-white">
                  *620#
                </span>
                <span className="block text-xs text-white/75">Orange Money · MTN MoMo</span>
              </div>
            </article>
          </div>

          {/* ── La ligne de frais, sur un portefeuille entier ──────────────── */}
          {/* Une carte tarifaire montre TOUJOURS le cas favorable. Celle-ci
              montre les deux : le barème affiché, et ce qu'un vrai carnet de
              commandes supporte une fois le plafond passé. C'est l'écart entre
              les deux qui est l'argument — pas le taux nominal, que n'importe
              quel concurrent peut afficher plus bas.

              Aucun de ces nombres n'est écrit ici : ils sortent du même calcul
              que le guichet de paiement. Un barème qui bouge côté serveur
              change cette section au prochain build, ou casse le typage. */}
          <div className="mt-6 rounded-2xl border border-navy-100 bg-white p-8 lg:p-10">
            <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
              <div>
                <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                  Une seule ligne de frais
                </p>
                <h3 className="mb-4 font-display text-2xl font-bold tracking-tight text-navy-950">
                  Le barème est un plafond, pas une promesse.
                </h3>
                <p className="mb-4 text-sm leading-relaxed text-navy-600">
                  Le palier gratuit affiche {pourcentage(PORTEFEUILLE_TYPE.tauxBaremeBps)} — mais la
                  commission est plafonnée à {formatGnf(PLAFOND_DEMO_CENTIMES)} par encaissement.
                  Dès qu’une facture dépasse ce seuil, le taux qu’elle supporte réellement descend.
                </p>
                <p className="text-sm leading-relaxed text-navy-600">
                  Sur un carnet de {PORTEFEUILLE_TYPE.facturesTotal} factures totalisant{" "}
                  {formatGnf(PORTEFEUILLE_TYPE.volumeCentimes)}, huit dépassent le plafond : le taux
                  moyen effectivement supporté tombe à{" "}
                  <strong>{pourcentage(PORTEFEUILLE_TYPE.tauxEffectifBps)}</strong>.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-navy-100 bg-grey p-5">
                  <p className="text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                    Barème affiché
                  </p>
                  <p className="mt-2 font-mono text-xl font-bold text-navy-950">
                    {pourcentage(PORTEFEUILLE_TYPE.tauxBaremeBps)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-navy-600">
                    sous le plafond de commission
                  </p>
                </div>
                {/* La seule carte Or de la section : c'est LE chiffre qu'on veut
                    voir retenu. Navy sur Or vaut 9.4:1 (R-11) ; l'inverse
                    serait illisible, et interdit. */}
                <div className="rounded-xl border border-or bg-or p-5 text-navy-950">
                  <p className="text-xs font-semibold tracking-[0.14em] uppercase">Taux réel</p>
                  <p className="mt-2 font-mono text-xl font-bold">
                    {pourcentage(PORTEFEUILLE_TYPE.tauxEffectifBps)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed">moyen sur ce carnet</p>
                </div>
                <div className="rounded-xl border border-navy-100 bg-grey p-5">
                  <p className="text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                    Épargné
                  </p>
                  <p className="mt-2 font-mono text-xl font-bold text-navy-950">
                    {formatGnf(PORTEFEUILLE_TYPE.economiePlafondCentimes)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-navy-600">
                    par le seul plafonnement
                  </p>
                </div>
                <p className="text-xs leading-relaxed text-navy-600 sm:col-span-3">
                  Rien n’est prélevé sur une facture émise et jamais réglée. Ces trois chiffres sont
                  calculés facture par facture par le code du guichet de paiement — c’est le carnet
                  du{" "}
                  <Link
                    href="/demo/marchand"
                    className="font-semibold text-navy-950 underline underline-offset-2"
                  >
                    tableau de bord de démonstration
                  </Link>
                  , au franc près.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Segment Cabinets ────────────────────────────────────────────── */}
      {/* Rupture sombre : c'est le fond de l'Espace Cabinet lui-même. Passer de
          la section à l'application ne doit pas être un changement de monde. */}
      <section id="cabinets" className="scroll-mt-24 bg-navy-950 py-24 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-or uppercase">
              Cabinets, CGA et fiduciaires
            </p>
            <h2 className="mb-5 font-display text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
              Quatre statuts. Aucun ne masque les autres.
            </h2>
            <p className="text-lg leading-relaxed text-white/75">
              Une facture peut être déposée, approuvée, encaissée <em>et</em> contestée en même
              temps. C’est cette situation-là qui appelle votre arbitrage — et c’est celle qu’un
              statut unique effacerait.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STATUTS.map((statut) => (
              <article key={statut.cle} className="rounded-2xl border border-navy-800 bg-white/5 p-6">
                <span
                  aria-hidden="true"
                  className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 text-or"
                >
                  {statut.icone}
                </span>
                <h3 className="font-display text-lg font-semibold">{statut.cle}</h3>
                <p className="mt-1 text-xs font-semibold tracking-[0.12em] text-or uppercase">
                  {statut.ecrivain}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-white/75">{statut.texte}</p>
              </article>
            ))}
          </div>

          {/* Le litige mérite son propre encart : c'est l'argument du segment.
              Un incident intercepté avant la clôture se règle à l'amiable ; le
              même incident découvert après est un contentieux. */}
          <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-navy-800 bg-white/5 p-8 text-center">
            <h3 className="mb-3 font-display text-xl font-semibold">
              « En litige » est une chance, pas une alarme.
            </h3>
            <p className="text-sm leading-relaxed text-white/75">
              Tant que l’exercice n’est pas clos, une contestation reste réparable : vous
              l’interceptez, vous émettez l’avoir, et l’affaire se règle à l’amiable entre le
              cabinet et le client. Le même incident découvert après la clôture ne se corrige plus —
              il se conteste.
            </p>
            {/* La fenêtre d'interception n'est pas une figure de style : la
                consolidation e-Reporting passe à intervalle FIXE, et c'est ce
                rythme qui sépare l'avoir amiable du contentieux. Le dire donne
                au cabinet la seule chose qu'un argument de vente lui doit —
                combien de temps il a. */}
            <p className="mt-4 text-sm leading-relaxed text-white/75">
              La consolidation e-Reporting passe <strong className="text-or">toutes les heures</strong>.
              Une contestation vue avant son passage se solde dans le même exercice ; la pièce
              certifiée, elle, ne bouge jamais — la correction est une NOUVELLE pièce qui pointe la
              première, et les deux restent lisibles côte à côte.
            </p>
          </div>

          {/* ── Rassurance : le tiers de confiance, et l'étanchéité ───────── */}
          {/* Le seul endroit de la page où le terme technique est écrit tel
              quel. Un cabinet qui instruit le dossier de sa clientèle a besoin
              de savoir OÙ la barrière est posée — dans la base ou dans
              l'application — parce que les deux réponses n'engagent pas la
              même chose. La phrase en clair reste devant ; le terme suit,
              pour qui le reconnaît. */}
          <div className="mt-6 rounded-2xl border border-navy-800 bg-white/5 p-8 lg:p-10">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-or uppercase">
                  Tiers de confiance privé certifié
                </p>
                <h3 className="mb-4 font-display text-2xl font-bold tracking-tight">
                  Vos dossiers ne se croisent jamais.
                </h3>
                <p className="mb-5 text-sm leading-relaxed text-white/75">
                  facture.gn n’est ni une administration ni un registre d’État : c’est un opérateur
                  privé certifié, qui conserve la preuve et la rend vérifiable — y compris contre
                  lui-même. Chaque entreprise que vous suivez vit dans son propre compartiment, et
                  la séparation est appliquée par la base de données sous chaque requête, pas par
                  l’écran au-dessus.
                </p>
                <p className="font-mono text-[11px] font-bold tracking-wide text-or uppercase">
                  PostgreSQL · FORCE ROW LEVEL SECURITY
                </p>
                <p className="mt-2 text-xs leading-relaxed text-white/75">
                  « FORCE » est le mot qui compte : la règle s’applique aussi au propriétaire de la
                  table. Une requête qui oublierait son filtre ne rend pas les lignes du voisin —
                  elle n’en rend aucune.
                </p>
              </div>
              <CloisonsEtanches ton="sombre" className="h-32 w-full sm:h-36" />
            </div>
          </div>

          {/* ── L'export FEC, tout de suite, sans compte ──────────────────── */}
          {/* Le bouton n'ouvre pas une brochure : il SERT le fichier. Un
              expert-comptable n'a aucune raison de croire une plateforme sur
              parole quant au format qu'elle produit — il ouvre le fichier dans
              son tableur et il compte les colonnes. Rendre ce geste possible
              depuis la page publique est l'argument, pas le paragraphe qui le
              décrit.

              Le fichier servi est celui du jeu de démonstration, qui
              n'appartient à personne (/demo/cabinet/fec) — jamais les écritures
              d'une vraie organisation, qui vivent derrière trust-api et exigent
              un mandat actif. */}
          <div className="mt-6 rounded-2xl border border-navy-800 bg-white/5 p-8 lg:p-10">
            <div className="flex flex-wrap items-center justify-between gap-8">
              <div className="max-w-2xl">
                <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-or uppercase">
                  Article A47 A-1 du LPF
                </p>
                <h3 className="mb-4 font-display text-2xl font-bold tracking-tight">
                  Le FEC se vérifie, il ne se promet pas.
                </h3>
                <p className="text-sm leading-relaxed text-white/75">
                  18 colonnes tabulées, UTF-8, comptes SYSCOHADA, une écriture par mouvement —
                  jamais une ligne agrégée par facture — et le règlement porté au journal de banque
                  pour les seules factures encaissées. Débits et crédits s’équilibrent au centime.
                  Téléchargez-le et comptez les colonnes.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {/* `prefetch={false}` : sans lui, Next irait chercher la route au
                    survol, c'est-à-dire générerait le fichier pour quelqu'un qui
                    n'a pas encore cliqué. Un export se déclenche au clic. */}
                <ButtonLink
                  href="/demo/cabinet/fec"
                  prefetch={false}
                  variant="accent"
                  size="lg"
                  surface="sombre"
                >
                  <IconeDepot />
                  Exporter le FEC
                </ButtonLink>
                <ButtonLink href="/demo/cabinet" variant="secondary" size="lg" surface="sombre">
                  Ouvrir la console cabinet
                </ButtonLink>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-12 max-w-2xl text-center">
            <p className="mb-8 text-sm leading-relaxed text-white/75">
              Un mandat par client, accordé par le client et révocable par lui. Vos collaborateurs
              travaillent sous votre structure ; le badge « vérifié par l’Ordre » attend le contrôle
              OCAECG et ne s’auto-décerne pas.
            </p>
            <ButtonLink href="/inscription" variant="secondary" size="lg" surface="sombre">
              Créer mon cabinet
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* ─── Segment Grands comptes, acheteurs publics et banques ────────── */}
      {/* LE PUBLIC LE PLUS EXIGEANT DE LA PAGE, et le seul qui n'achète pas un
          service : il achète une GARANTIE OPPOSABLE. Un analyste crédit qui
          instruit un rachat de créance et un DAF qui engage des deniers publics
          se posent la même question — « qu'est-ce qui m'empêche de payer deux
          fois ? ». Toute cette section répond à celle-là.

          C'est aussi le seul espace où le vocabulaire technique est un ARGUMENT
          et non un ornement : « Ed25519 » et « K5 » sont lus par des gens dont
          le métier est de les reconnaître. Chacun reste posé à côté de sa
          formulation en clair, jamais à la place. */}
      <section id="grands-comptes" className="scroll-mt-24 border-b border-navy-100 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
              Grands comptes, acheteurs publics et banques
            </p>
            <h2 className="mb-5 font-display text-3xl leading-tight font-bold tracking-tight text-navy-950 sm:text-4xl">
              Une créance ne peut être cédée qu’une seule fois.
            </h2>
            <p className="text-lg leading-relaxed text-navy-600">
              C’est la garantie qui rend une facture guinéenne finançable — et elle tient parce
              qu’elle est posée dans la base, pas dans l’écran qui l’affiche.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* 1 — La signature. Le terme technique EST la valeur ici : un
                risk officer qui ne le lit pas repart sans réponse. */}
            <article className="flex flex-col rounded-2xl border border-navy-100 bg-white p-8">
              <span
                aria-hidden="true"
                className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-navy-100 text-navy-950"
              >
                <IconeApprobation />
              </span>
              <p className="mb-2 font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
                Signature Ed25519
              </p>
              <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                Vérifiable sans nous, et contre nous.
              </h3>
              <p className="mb-6 text-sm leading-relaxed text-navy-600">
                Chaque facture porte sa propre signature, apposée à la seconde de l’émission, et
                scelle la précédente. Vérifier une pièce ne demande ni compte, ni appel à notre
                support, ni notre bonne foi : la preuve se contrôle sur le document.
              </p>
              <ul className="mt-auto flex flex-col gap-2.5">
                {[
                  "Une clé par organisation — nous n’émettons jamais en son nom",
                  "Chaînage : retirer une pièce d’une suite laisse la cassure visible",
                  "Antériorité établie sans avoir à nous croire sur parole",
                ].map((point) => (
                  <li key={point} className="flex gap-2.5 text-sm leading-relaxed text-navy-600">
                    <span aria-hidden="true" className="text-navy-950">
                      <IconeCoche />
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
            </article>

            {/* 2 — Le bouclier K5. Seule carte Navy de la rangée : c'est
                l'invariant sur lequel toute la couche financement repose, et
                le seul point de la page où un défaut coûterait de l'argent
                réel à un tiers. */}
            <article className="flex flex-col rounded-2xl border border-navy-800 bg-navy-950 p-8 text-white">
              <span
                aria-hidden="true"
                className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 text-or"
              >
                <IconeVerrou />
              </span>
              <p className="mb-2 font-mono text-[11px] font-bold tracking-wide text-or uppercase">
                Bouclier anti-double-nantissement
              </p>
              <h3 className="mb-3 font-display text-xl font-semibold">
                Pas de seconde cession. Jamais.
              </h3>
              <p className="mb-6 text-sm leading-relaxed text-white/75">
                Dès qu’un établissement a racheté une créance, la facture porte cette cession. Toute
                action de rachat secondaire est alors <strong>structurellement absente</strong> de
                l’interface — pas grisée « pour information », pas masquée par un attribut que le
                premier inspecteur d’éléments rouvre : jamais rendue, et revérifiée côté serveur à
                chaque appel.
              </p>
              <div className="mt-auto rounded-xl border border-navy-800 bg-white/5 p-5">
                <p className="font-mono text-[11px] font-bold tracking-wide text-or uppercase">
                  Invariant K5
                </p>
                <p className="mt-2 text-xs leading-relaxed text-white/75">
                  Le verrou se lit sur une colonne unique de la facture, jamais sur un état
                  reconstitué par l’écran. Deux endroits où la règle peut vivre, c’est un endroit où
                  elle peut diverger.
                </p>
              </div>
            </article>

            {/* 3 — Le rachat. La carte dit le délai ET la réserve : le
                versement n'est pas notre geste, et l'écrire ici évite de
                vendre un engagement que nous ne tenons pas nous-mêmes. */}
            <article className="flex flex-col rounded-2xl border border-navy-100 bg-white p-8">
              <span
                aria-hidden="true"
                className="mb-6 flex h-10 w-10 items-center justify-center rounded-xl border border-navy-100 text-navy-950"
              >
                <IconeInstitution />
              </span>
              <p className="mb-2 font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
                Capital Layer
              </p>
              <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                Rachat de créance sous 24 h.
              </h3>
              <p className="mb-6 text-sm leading-relaxed text-navy-600">
                Dès que l’acheteur — administration comprise — a reconnu le service fait, la créance
                devient finançable. Akiba Finance et les autres établissements agréés BCRG (Ecobank,
                UBA, COFINA) la rachètent sans attendre l’échéance du marché.
              </p>
              <div className="mt-auto">
                <FluxCapital />
                <p className="mt-2 text-xs leading-relaxed text-navy-600">
                  facture.gn établit l’éligibilité, la rend opposable et pose le verrou. Le
                  versement et ses conditions se règlent entre l’établissement financier et
                  l’entreprise — nous ne prêtons pas, et nous ne le laissons pas croire.
                </p>
              </div>
            </article>
          </div>

          {/* ── Les deux rails, vus du côté qui mandate ─────────────────── */}
          {/* Ce bloc vivait dans l'espace PME, où il parlait au fournisseur.
              Il est ici parce que le lecteur qui doit COMPRENDRE les deux rails
              est celui qui liquide la dépense ou qui avance l'argent : le
              fournisseur, lui, n'a qu'un choix à faire, et il le fait dans
              l'application, pas sur la page d'accueil. */}
          <div className="mt-6 rounded-2xl border border-navy-100 bg-white p-8 lg:p-10">
            <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
              <div>
                <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                  Commande publique
                </p>
                <h3 className="mb-4 font-display text-2xl font-bold tracking-tight text-navy-950">
                  Deux rails, et l’ordonnateur sait toujours lequel il paie.
                </h3>
                <p className="text-sm leading-relaxed text-navy-600">
                  Au moment du visa de liquidation, la console de l’acheteur public affiche qui
                  détient réellement la créance. Un mandatement adressé au fournisseur alors que sa
                  facture a déjà été cédée est la faute que ce verrou existe pour empêcher.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-navy-100 bg-grey p-5">
                  <p className="font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
                    Rail A
                  </p>
                  <h4 className="mt-2 font-display text-sm font-semibold text-navy-950">
                    La créance a été cédée
                  </h4>
                  <p className="mt-2 text-sm leading-relaxed text-navy-600">
                    Le fournisseur a été payé d’avance par l’établissement financier. C’est ce
                    dernier qui attend le règlement du Trésor — et le rail se LIT sur la facture, il
                    ne se choisit pas depuis cet écran.
                  </p>
                </div>
                <div className="rounded-xl border border-navy-100 bg-grey p-5">
                  <p className="font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
                    Rail B
                  </p>
                  <h4 className="mt-2 font-display text-sm font-semibold text-navy-950">
                    Règlement direct à l’échéance
                  </h4>
                  <p className="mt-2 text-sm leading-relaxed text-navy-600">
                    Aucun financement, zéro commission. C’est l’état par défaut de toute facture :
                    une absence d’action, pas une option à activer.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── DAF publics : la conformité LFI 2025 ────────────────────── */}
          <div className="mt-6 rounded-2xl border border-navy-100 bg-white p-8 lg:p-10">
            <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
              <div>
                <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                  Directions financières · Loi de Finances 2025
                </p>
                <h3 className="mb-4 font-display text-2xl font-bold tracking-tight text-navy-950">
                  Le reçu e-TVA est la preuve. Pas le statut.
                </h3>
                <p className="mb-4 text-sm leading-relaxed text-navy-600">
                  Chaque facture est déposée au guichet e-TVA (SAFIG&nbsp;2) exigé par la Loi de
                  Finances 2025. Mais un dépôt marqué « transmis » sans numéro de reçu ne prouve
                  rien : c’est le NUMÉRO rendu par l’administration qui vaut preuve, et c’est lui
                  que la plateforme conserve, affiche et exporte.
                </p>
                <p className="text-sm leading-relaxed text-navy-600">
                  La distinction n’est pas académique. Une direction financière qui archive un
                  statut au lieu d’un reçu découvre le trou au premier contrôle, exercice clos.
                </p>
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-navy-100 bg-grey p-5">
                  <dt className="text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                    Déposé
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-navy-600">
                    L’enfilement au guichet est automatique à l’émission. Ni l’émetteur ni son
                    client n’ont de démarche à faire.
                  </dd>
                </div>
                <div className="rounded-xl border border-navy-100 bg-grey p-5">
                  <dt className="text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
                    Prouvé
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-navy-600">
                    Le numéro de reçu fiscal est rattaché à la pièce, exporté avec le FEC et
                    opposable au contrôle.
                  </dd>
                </div>
                <p className="text-xs leading-relaxed text-navy-600 sm:col-span-2">
                  facture.gn est un tiers de confiance <strong>privé</strong> certifié : il
                  télétransmet et conserve la preuve, il ne délivre aucun agrément à votre place et
                  ne se substitue à aucune administration.
                </p>
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Segment Intégrateurs ────────────────────────────────────────── */}
      {/* La seule zone de la page où le vocabulaire technique est la valeur :
          le lecteur est un développeur qui cherche un contrat d'entrée. */}
      <section id="developpeurs" className="scroll-mt-24 border-b border-navy-100 bg-white py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
              Éditeurs et intégrateurs
            </p>
            <h2 className="mb-5 font-display text-3xl leading-tight font-bold tracking-tight text-navy-950 sm:text-4xl">
              Branchez votre logiciel de gestion.
            </h2>
            <p className="text-lg leading-relaxed text-navy-600">
              Odoo, SAP, OwoDesk ou votre outil interne poussent leurs documents sur un schéma
              unique.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            {/* overflow-x-auto : un bloc de code est la seule chose de cette
                page autorisée à déborder — on le laisse défiler seul plutôt que
                de casser l'indentation ou de faire scroller la page entière. */}
            <div className="overflow-x-auto rounded-2xl border border-navy-800 bg-navy-950 p-6">
              <pre className="font-mono text-xs leading-relaxed text-white">
                <code>{SCHEMA_CONNECTEUR}</code>
              </pre>
            </div>

            <ul className="flex flex-col gap-4">
              {REGLES_CONNECTEUR.map((regle) => (
                <li key={regle} className="flex gap-3 text-sm leading-relaxed text-navy-600">
                  <span aria-hidden="true" className="text-navy-950">
                    <IconeCoche />
                  </span>
                  {regle}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── Vérification publique ───────────────────────────────────────── */}
      <section id="verify" className="scroll-mt-24 bg-navy-950 py-24 text-white">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="mb-5 font-display text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
            Vérifier une facture, sans compte.
          </h2>
          <p className="mx-auto mb-10 max-w-2xl text-lg text-white/75">
            Toute facture certifiée porte un identifiant de vérification. Saisissez-le pour
            confirmer son authenticité, son émetteur et son montant.
          </p>

          {/* Le formulaire est bâti pour un fond clair (bordures et libellés
              Navy) : on le pose sur une carte blanche plutôt que de le
              réécrire en variante sombre. */}
          <div className="mx-auto max-w-2xl rounded-2xl border border-navy-800 bg-white p-6 text-left text-navy-950 sm:p-8">
            <CertificationLookupForm />
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-sm text-white/75">
            Une facture introuvable ici n’a pas été certifiée par facture.gn.
          </p>
        </div>
      </section>

      {/* ─── Garanties ───────────────────────────────────────────────────── */}
      {/* Contenu volontairement factuel — chaque point correspond à un mécanisme
          réellement implémenté côté trust-api, pas à une promesse. */}
      <section id="security" className="scroll-mt-24 py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-5 font-display text-3xl leading-tight font-bold tracking-tight text-navy-950 sm:text-4xl">
              Ce qui rend une facture infalsifiable
            </h2>
            <p className="text-lg leading-relaxed text-navy-600">
              Quatre mécanismes indépendants, dont aucun ne repose sur notre bonne foi.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {GARANTIES.map((garantie) => (
              <article key={garantie.titre} className="rounded-2xl border border-navy-100 bg-white p-6">
                <h3 className="mb-2 font-display text-base font-semibold text-navy-950">
                  {garantie.titre}
                </h3>
                <p className="text-sm leading-relaxed text-navy-600">{garantie.texte}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─────────────────────────────────────────────────────────── */}
      {/* `<details>` natif, pas un accordéon React. Trois raisons, et la
          première suffirait : sans JavaScript — connexion coupée, PWA en cache
          froid, navigateur d'entrée de gamme — un accordéon en useState reste
          fermé pour toujours, et la réponse est INTROUVABLE. Ensuite, la
          recherche du navigateur (Ctrl+F) trouve le texte replié. Enfin,
          l'élément gère seul son état ARIA : rien à câbler, rien à oublier. */}
      <section id="faq" className="scroll-mt-24 border-t border-navy-100 bg-white py-24">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 text-center">
            <p className="mb-4 text-xs font-semibold tracking-[0.14em] text-navy-600 uppercase">
              Questions fréquentes
            </p>
            <h2 className="font-display text-3xl leading-tight font-bold tracking-tight text-navy-950 sm:text-4xl">
              Les questions qu’on nous pose avant de signer.
            </h2>
          </div>

          <div className="flex flex-col gap-4">
            {FAQ.map((entree) => (
              <details
                key={entree.question}
                className="group rounded-2xl border border-navy-100 bg-grey p-6 open:bg-white"
              >
                {/* `list-none` + le chevron maison : le triangle par défaut est
                    rendu différemment par chaque moteur, et n'est pas
                    orientable. Le curseur pointeur et la cible pleine largeur
                    font le reste — sur téléphone, on tape le titre, pas la
                    petite flèche. */}
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-base font-semibold text-navy-950 sm:text-lg">
                  {entree.question}
                  <span
                    aria-hidden="true"
                    className="mt-1 shrink-0 text-navy-950 transition-transform group-open:rotate-180"
                  >
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="h-4 w-4">
                      <path {...TRAIT} d="m3.5 6 4.5 4.5L12.5 6" />
                    </svg>
                  </span>
                </summary>
                <div className="mt-4 flex flex-col gap-3 text-sm leading-relaxed text-navy-600">
                  {entree.reponse}
                </div>
              </details>
            ))}
          </div>

          <div className="mt-12 text-center">
            <ButtonLink href="/inscription" variant="accent" size="lg">
              Créer mon compte
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
