import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui";
import { CertificationLookupForm } from "@/components/CertificationLookupForm";
import { formatGnf } from "@/lib/format";
import {
  COMMISSION_BPS,
  COMMISSION_CAP_CENTIMES,
  FRAIS_PASSERELLE_BPS,
  PDP_GATEWAY_MIN_TIER,
  pourcentage,
  tierLabel,
} from "@/lib/plans";

// Page d'accueil publique. L'en-tête, la navigation et le pied de page vivent
// dans `(marketing)/layout.tsx` ; ce fichier ne porte que le discours.
//
// Écrite entièrement avec les tokens du Design System (globals.css) : aucune
// couleur en dur, sous peine d'échec du garde-fou
// `design-system.guardrails.spec.ts`, qui tourne en CI.
//
// Trois règles de la charte cadrent ce qui suit :
//   R-01  jamais de dégradé, et jamais les couleurs du drapeau guinéen — la
//         marque est « Navy Autorité + Or de Guinée », pas vert/rouge/jaune.
//   R-11  jamais de texte clair sur l'Or (1.8:1). L'Or porte du Navy (9.4:1).
//   AA    l'échelle Navy sous navy-600 est faite pour les bordures, jamais
//         pour du texte.
//
// Aucune ombre non plus : la hiérarchie tient au contraste des surfaces
// (blanc sur --grey), pas à une élévation qui s'évanouit sur un écran d'entrée
// de gamme — c'est la raison déjà inscrite dans la primitive Card.
//
// ── LES CHIFFRES VIENNENT DU CODE ────────────────────────────────────────────
// Taux, plafonds et paliers sont IMPORTÉS de lib/plans.ts, jamais recopiés en
// dur dans une phrase. Ce fichier-là est le miroir vérifié de ce que trust-api
// prélève réellement, et il porte la cicatrice de l'épisode où la plaquette
// annonçait 1,1 % pendant que le code prélevait 1,50 %. Une landing qui répète
// un chiffre à la main rouvre exactement cette faille : ici, un taux qui change
// côté serveur change la page au prochain build, ou casse le typage.
//
// ── CE QUE CETTE PAGE NE PROMET PAS ──────────────────────────────────────────
// Le rachat de créance B2G est présenté comme ce qu'il EST côté serveur :
// l'enregistrement d'un choix de rail, l'éligibilité opposable et le verrou
// anti-double-cession. Pas de délai de versement annoncé, pas de « sans
// décote » : aucune exécution de virement n'existe dans ce dépôt (le plan
// 2026-08-19-b2g-financing-rail.md écarte explicitement Djomy Payout), et
// aucune grille ne définit le coût de l'avance. Promettre l'un ou l'autre
// engagerait la plateforme sur un terrain que son code ne tient pas.

export const metadata: Metadata = {
  title: "facture.gn — Plateforme nationale de certification fiscale",
  description:
    "Sécurisation, immuabilité et télétransmission des factures certifiées pour les PME, les cabinets comptables et les ERP en République de Guinée.",
};

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

// ── Les quatre statuts du parcours légal (LFI 2025) ──────────────────────────
// Miroir d'affichage de lib/invoice-lifecycle.ts, qui reste la source unique :
// quatre colonnes ORTHOGONALES, écrites par quatre acteurs différents. C'est ce
// qui permet à un cabinet d'intercepter un litige sur une facture par ailleurs
// déposée, approuvée ET encaissée — la situation qui appelle le plus une
// décision, et que tout badge « le plus avancé » masquerait.
const STATUTS = [
  {
    cle: "Déposée",
    ecrivain: "Sync eTax",
    texte: "La facture est parvenue à la DGI et porte son numéro de reçu eTax.",
    icone: <IconeDepot />,
  },
  {
    cle: "Approuvée",
    ecrivain: "Ordonnateur public",
    texte: "L’administration a validé la liquidation. C’est ce qui rend la créance finançable.",
    icone: <IconeApprobation />,
  },
  {
    cle: "Litige",
    ecrivain: "Le client",
    texte: "Une contestation est ouverte. Seul statut qui attend une action : l’avoir rectificatif.",
    icone: <IconeLitige />,
  },
  {
    cle: "Encaissée",
    ecrivain: "Encaissement",
    texte:
      "Le règlement est arrivé. Indépendant des trois autres — une facture payée peut rester contestée.",
    icone: <IconeEncaissement />,
  },
];

const GARANTIES = [
  {
    titre: "Chaînage des factures",
    texte:
      "Chaque facture émise scelle le sceau de la précédente. Retirer ou modifier une pièce rompt la chaîne, et la rupture est détectable publiquement.",
  },
  {
    titre: "Signature par organisation",
    texte:
      "Chaque entreprise dispose de sa propre clé de signature. Un sceau ne peut pas être produit au nom d’une autre, même depuis la plateforme.",
  },
  {
    titre: "Ancrage périodique",
    texte:
      "Les sceaux sont regroupés et ancrés par lots. L’antériorité d’une facture devient opposable sans avoir à faire confiance à l’exploitant.",
  },
  {
    titre: "Cloisonnement en base",
    texte:
      "L’isolation entre entreprises est appliquée par PostgreSQL lui-même, sous chaque requête — pas seulement par le code applicatif au-dessus.",
  },
];

// Extrait FIDÈLE de createPdpInvoiceSchema (apps/trust-api/src/pdp/dto/
// create-pdp-invoice.dto.ts) : les noms de champs, les types et les bornes sont
// ceux que le serveur applique réellement. Un connecteur écrit sur la foi de ce
// bloc doit passer du premier coup — c'est la seule raison d'afficher du code
// sur une page publique.
const SCHEMA_PDP = `POST /pdp/invoices     X-PDP-API-Key: <clé de l'organisation>

createPdpInvoiceSchema = z.object({
  clientUniqueId:  z.string().min(1).max(128),  // clé d'idempotence
  transactionType: z.enum(["b2b", "b2g", "b2c"]),
  totalHT:         montantGnf,       // "1000000" — GNF, pas de centimes
  totalVAT:        montantGnf,       // totalTTC est DÉRIVÉ, jamais reçu
  issueDate:       z.coerce.date(),
  customer:        { name, nif?, address? }.optional(),
  lines:           [{ description, quantity, unitPrice }].min(1).optional(),
  referenceMarche, numeroBonCommande,           // B2G, déclaratifs
  numeroContrat,   numeroEngagement,
})`;

const REGLES_PDP = [
  "Aucun organizationId dans le corps : il vient de la clé API, jamais d’un champ que l’appelant contrôle.",
  "totalHT doit être exactement la somme des lignes — aucune remise globale n’est acceptée sur ce chemin.",
  "lines est obligatoire en b2b/b2g (OHADA Article 23) ; b2c part en e-reporting agrégé.",
  "clientUniqueId rejoué à l’identique rend le document déjà certifié, jamais un doublon.",
];

export default function LandingPage() {
  return (
    <>
      {/* ─── Hero ────────────────────────────────────────────────────────── */}
      <section className="border-b border-navy-100 bg-white py-16 lg:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-navy-100 bg-grey px-3 py-1 text-xs font-semibold text-navy-600">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-or" />
              Conforme aux directives DGI et interopérable avec le guichet unique APIP
            </p>
            <h1 className="mb-6 font-display text-4xl leading-tight font-bold tracking-tight text-navy-950 sm:text-5xl lg:text-6xl">
              L’infrastructure de confiance de la facturation en Guinée.
            </h1>
            <p className="mb-8 text-lg leading-relaxed text-navy-600 sm:text-xl">
              Sécurisez vos opérations commerciales, automatisez vos déclarations de TVA et protégez
              votre entreprise grâce au registre d’immuabilité national et au cloisonnement de
              données RLS.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row">
              <ButtonLink href="/inscription" variant="accent" size="lg">
                Immatriculer ma PME
              </ButtonLink>
              <ButtonLink href="#verify" variant="secondary" size="lg">
                Vérifier l’authenticité d’un reçu
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Segment PME ─────────────────────────────────────────────────── */}
      <section id="pme" className="scroll-mt-24 border-b border-navy-100 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <p className="mb-3 font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
              PME, commerces et associations
            </p>
            <h2 className="mb-4 font-display text-3xl font-bold tracking-tight text-navy-950">
              Émettre ne coûte rien. Encaisser, oui — et c’est plafonné.
            </h2>
            <p className="leading-relaxed text-navy-600">
              Aucun quota de volume n’existe côté serveur : les seules limites du palier gratuit
              portent sur les succursales et les membres d’équipe, jamais sur le nombre de factures.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
            <article className="flex flex-col rounded-2xl border border-navy-100 bg-white p-8">
              <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                Volume gratuit, sans plafond
              </h3>
              <p className="mb-6 text-sm leading-relaxed text-navy-600">
                Certifiez autant de factures que votre activité l’exige. Le NIF et le numéro eTax
                restent optionnels : on commence à facturer avant d’être en règle, pas l’inverse.
              </p>
              <ul className="mt-auto flex flex-col gap-2.5">
                {[
                  "Émission et certification illimitées",
                  "Catalogue produits et suivi de stock",
                  "Interface pensée d’abord pour le mobile",
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

            <article className="flex flex-col rounded-2xl border border-navy-100 bg-white p-8">
              <h3 className="mb-3 font-display text-xl font-semibold text-navy-950">
                Une commission, plafonnée
              </h3>
              <p className="mb-6 text-sm leading-relaxed text-navy-600">
                Le palier gratuit prélève {pourcentage(COMMISSION_BPS.freemium)} du montant
                encaissé, et jamais plus de {formatGnf(COMMISSION_CAP_CENTIMES.freemium)} par
                encaissement. Rien n’est prélevé sur une facture émise mais non réglée.
              </p>
              {/* Chasse fixe : ce sont des données financières arrêtées, le cas
                  où la charte réclame le mono. */}
              <dl className="mt-auto flex flex-col gap-3 rounded-xl border border-navy-100 bg-grey p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-navy-600">Commission plateforme</dt>
                  <dd className="font-mono text-sm font-bold text-navy-950">
                    {pourcentage(COMMISSION_BPS.freemium)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm text-navy-600">Plafond par encaissement</dt>
                  <dd className="font-mono text-sm font-bold text-navy-950">
                    {formatGnf(COMMISSION_CAP_CENTIMES.freemium)}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 border-t border-navy-100 pt-3">
                  <dt className="text-sm text-navy-600">Passerelle, à la charge du payeur</dt>
                  <dd className="font-mono text-sm font-bold text-navy-950">
                    {pourcentage(FRAIS_PASSERELLE_BPS)}
                  </dd>
                </div>
              </dl>
            </article>

            {/* Canal USSD — seule carte en Navy plein de cette rangée : c'est le
                canal qui n'a pas d'équivalent chez les autres, et le contraste
                de surface suffit à le distinguer sans ombre ni dégradé. */}
            <article className="flex flex-col rounded-2xl border border-navy-800 bg-navy-950 p-8 text-white">
              <p className="mb-4 inline-block self-start rounded-full bg-or px-2.5 py-1 font-mono text-[11px] font-bold text-navy-950">
                INCLUSION TOTALE
              </p>
              <h3 className="mb-3 font-display text-xl font-semibold">Canal hors-ligne USSD</h3>
              <p className="mb-6 text-sm leading-relaxed text-white/75">
                Zéro connexion internet, zéro smartphone. Certifiez et encaissez vos ventes depuis
                n’importe quel téléphone basique, via le code court sécurisé national.
              </p>
              {/* Chasse fixe : c'est un code à composer chiffre par chiffre,
                  exactement le cas où la charte réclame le mono pour lever
                  l'ambiguïté 0/O et 1/l. */}
              <div className="mt-auto rounded-xl border border-navy-800 bg-white/5 p-4 text-center">
                <span className="mb-1 block font-mono text-2xl font-bold tracking-widest text-white">
                  *620#
                </span>
                <span className="block text-xs text-white/75">
                  Composez ce code sur votre téléphone (Orange / MTN)
                </span>
              </div>
            </article>
          </div>

          {/* ── Capital Layer ─────────────────────────────────────────────── */}
          <div className="mt-8 rounded-2xl border border-navy-100 bg-white p-8 lg:p-10">
            <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
              <div>
                <p className="mb-3 font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
                  Capital Layer — marchés publics
                </p>
                <h3 className="mb-4 font-display text-2xl font-bold tracking-tight text-navy-950">
                  Une créance sur l’État n’est plus une attente.
                </h3>
                <p className="text-sm leading-relaxed text-navy-600">
                  Dès qu’un ordonnateur public a validé la liquidation, votre facture devient
                  finançable. facture.gn établit cette éligibilité, la rend opposable, et verrouille
                  la créance contre toute seconde cession — le verrou anti-double-financement est
                  posé en base, pas seulement dans l’écran.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-navy-100 bg-grey p-5">
                  <h4 className="font-display text-sm font-semibold text-navy-950">
                    Rail A — Avance immédiate
                  </h4>
                  <p className="mt-2 text-sm leading-relaxed text-navy-600">
                    Un établissement agréé BCRG (Ecobank, UBA, COFINA, Akiba Finance) rachète la
                    créance sans attendre le Trésor.
                  </p>
                </div>
                <div className="rounded-xl border border-navy-100 bg-grey p-5">
                  <h4 className="font-display text-sm font-semibold text-navy-950">
                    Rail B — Attente du Trésor
                  </h4>
                  <p className="mt-2 text-sm leading-relaxed text-navy-600">
                    Vous conservez la créance jusqu’à l’échéance nominale du marché. Zéro
                    commission.
                  </p>
                </div>
                {/* La réserve est DANS la carte, pas en note de bas de page : le
                    lecteur qui compare les deux rails est exactement celui qui
                    doit savoir où s'arrête le rôle de la plateforme. */}
                <p className="text-xs leading-relaxed text-navy-600 sm:col-span-2">
                  facture.gn enregistre le rail choisi, notifie le partenaire et scelle
                  l’éligibilité. Les conditions de l’avance et son versement se règlent entre
                  l’établissement financier et votre entreprise.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Segment Cabinets ────────────────────────────────────────────── */}
      {/* Section sombre : c'est le fond de CabinetShell. Le segment le plus
          exigeant de la page reçoit la surface la plus dense. */}
      <section id="cabinets" className="scroll-mt-24 bg-navy-950 py-20 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <p className="mb-3 font-mono text-[11px] font-bold tracking-wide text-or uppercase">
              Cabinets, CGA et fiduciaires
            </p>
            <h2 className="mb-4 font-display text-3xl font-bold tracking-tight">
              Quatre statuts, quatre écrivains, aucune hiérarchie.
            </h2>
            <p className="leading-relaxed text-white/75">
              Le parcours légal LFI 2025 ne se résume pas à une barre de progression. Ses quatre
              états sont orthogonaux : une facture peut être déposée, approuvée, encaissée
              <em> et </em> contestée en même temps. C’est précisément cette situation qui appelle
              votre arbitrage, et c’est celle qu’un statut unique effacerait.
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
                <p className="mt-1 font-mono text-[11px] font-bold tracking-wide text-or uppercase">
                  {statut.ecrivain}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-white/75">{statut.texte}</p>
              </article>
            ))}
          </div>

          <div className="mx-auto mt-12 max-w-3xl text-center">
            <p className="mb-6 text-sm leading-relaxed text-white/75">
              Un mandat par client, accordé par le client et révocable par lui. Vos collaborateurs
              travaillent sous votre structure ; le badge « vérifié par l’Ordre » attend le contrôle
              OCAECG et ne s’auto-décerne pas.
            </p>
            <ButtonLink href="/inscription" variant="secondary" size="lg">
              Créer mon cabinet
            </ButtonLink>
          </div>
        </div>
      </section>

      {/* ─── Segment Développeurs ────────────────────────────────────────── */}
      <section id="developpeurs" className="scroll-mt-24 border-b border-navy-100 bg-white py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-14 max-w-3xl text-center">
            <p className="mb-3 font-mono text-[11px] font-bold tracking-wide text-navy-600 uppercase">
              Hub PDP — plateforme de dématérialisation partenaire
            </p>
            <h2 className="mb-4 font-display text-3xl font-bold tracking-tight text-navy-950">
              Un contrat d’entrée, et rien à deviner.
            </h2>
            <p className="leading-relaxed text-navy-600">
              Odoo, OwoDesk ou votre ERP interne poussent leurs documents sur un schéma unique. Le
              corps ne porte aucun identifiant d’organisation : il vient de la clé API.
            </p>
          </div>

          <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
            {/* overflow-x-auto : un bloc de code est la seule chose de cette
                page autorisée à déborder — on le laisse défiler seul plutôt que
                de casser l'indentation ou de faire scroller la page entière. */}
            <div className="overflow-x-auto rounded-2xl border border-navy-800 bg-navy-950 p-6">
              <pre className="font-mono text-xs leading-relaxed text-white">
                <code>{SCHEMA_PDP}</code>
              </pre>
            </div>

            <div>
              <ul className="flex flex-col gap-4">
                {REGLES_PDP.map((regle) => (
                  <li key={regle} className="flex gap-3 text-sm leading-relaxed text-navy-600">
                    <span aria-hidden="true" className="text-navy-950">
                      <IconeCoche />
                    </span>
                    {regle}
                  </li>
                ))}
              </ul>

              {/* Le seuil de palier est dit ICI, pas dans une FAQ : un
                  intégrateur qui découvre la contrainte après avoir écrit son
                  connecteur a perdu son temps par notre faute. */}
              <div className="mt-6 rounded-xl border border-navy-100 bg-grey p-5">
                <p className="font-display text-sm font-semibold text-navy-950">
                  L’émission d’une clé X-PDP-API-Key ouvre au palier {tierLabel(PDP_GATEWAY_MIN_TIER)}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-navy-600">
                  La passerelle est réservée aux organisations à ce palier ou au-dessus. Les paliers
                  inférieurs certifient depuis l’application et le canal USSD.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Vérification publique ───────────────────────────────────────── */}
      <section id="verify" className="scroll-mt-24 bg-navy-950 py-20 text-white">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          <h2 className="mb-4 font-display text-3xl font-bold tracking-tight">
            Vérification instantanée du registre national
          </h2>
          <p className="mx-auto mb-10 max-w-2xl text-white/75">
            Toute facture certifiée porte un identifiant de vérification. Saisissez-le pour
            confirmer son authenticité, son émetteur et son montant — sans compte, et sans accès à
            un espace privé.
          </p>

          {/* Le formulaire est bâti pour un fond clair (bordures et libellés
              Navy) : on le pose sur une carte blanche plutôt que de le
              réécrire en variante sombre. */}
          <div className="mx-auto max-w-2xl rounded-2xl border border-navy-800 bg-white p-6 text-left text-navy-950 sm:p-8">
            <CertificationLookupForm />
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-sm text-white/75">
            Un reçu introuvable dans le registre n’a pas été certifié par facture.gn.
          </p>
        </div>
      </section>

      {/* ─── Garanties cryptographiques ──────────────────────────────────── */}
      {/* Contenu volontairement factuel — chaque point correspond à un mécanisme
          réellement implémenté côté trust-api, pas à une promesse. */}
      <section id="security" className="scroll-mt-24 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto mb-16 max-w-3xl text-center">
            <h2 className="mb-4 font-display text-3xl font-bold tracking-tight text-navy-950">
              Ce qui rend une facture infalsifiable
            </h2>
            <p className="leading-relaxed text-navy-600">
              Quatre mécanismes indépendants, dont aucun ne repose sur la bonne foi de l’émetteur.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {GARANTIES.map((garantie) => (
              <article key={garantie.titre} className="rounded-2xl border border-navy-100 bg-white p-6">
                <h3 className="mb-2 font-display text-base font-semibold text-navy-950">{garantie.titre}</h3>
                <p className="text-sm leading-relaxed text-navy-600">{garantie.texte}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
