import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui";
import { formatGnf } from "@/lib/format";
import { COMMISSION_CAP_CENTIMES } from "@/lib/plans";

export const metadata: Metadata = { title: "Créer un compte — facture.gn" };

// Porte d'entrée unique : elle aiguille vers les QUATRE publics de la
// plateforme, qui n'ont ni les mêmes écrans, ni les mêmes identités, ni les
// mêmes droits.
//
//   • Le marchand      — OrganizationMember, mot de passe, coquille /dashboard
//   • Le cabinet       — PracticeMember, concept d'appartenance SÉPARÉ
//                        (schema.prisma), coquille /cabinet
//   • L'ordonnateur    — PublicBuyerAccountMember, troisième concept encore,
//                        coquille /daf
//   • L'agent terrain  — marchand doté d'isCommercialAgent, qui inscrit LES
//                        AUTRES
//
// Les confondre était le vrai problème : un cabinet qui créait « un compte »
// atterrissait dans l'onboarding PME, et un acheteur n'avait aucune porte.
//
// ── LA RUPTURE CLAIR / SOMBRE ────────────────────────────────────────────────
// Les deux voies institutionnelles (cabinet, ordonnateur public) sont posées en
// Navy plein, les deux voies marchandes en blanc. Ce n'est pas un effet de
// style : ces deux univers ont des barrières d'entrée que les deux autres n'ont
// pas, et la bascule de fond l'annonce AVANT la lecture. C'est aussi le fond que
// portent déjà leurs coquilles (CabinetShell, /daf) — la carte montre l'espace
// où elle mène.
//
// CE QUE CET ÉCRAN NE FAIT PAS, ET POURQUOI :
//
//   • Aucun champ « code d'invitation » sur la voie ordonnateur public. Il n'en
//     existe aucun côté trust-api : POST /public-buyer-accounts ne demande pas
//     de code, et la bascule pending → verified n'a délibérément AUCUN endpoint
//     (schema.prisma). Un champ qui n'a rien à valider ne filtre rien : il
//     donnerait le sentiment d'une barrière là où la vraie barrière est
//     ailleurs, ce qui est pire que pas de champ du tout.
//
//   • Aucune saisie du code de parrainage ici. Le code Base32 se saisit APRÈS la
//     création du compte, sur /dashboard/parrainage : POST /referrals/attach
//     exige @Roles("owner","admin"), donc une organisation qui existe déjà. Le
//     demander avant l'inscription serait le demander à quelqu'un qui n'a pas
//     encore de quoi le poser.
//
// PAS DE SÉLECTEUR DE LANGUE, contrairement à la maquette. L'enum
// PreferredLanguage existe bien en base (fr, pular, malinke, soussou), mais
// AUCUNE route ne l'accepte — ni POST /auth/register, ni POST /organizations —
// et apps/web n'a aucune plomberie i18n. Un sélecteur ne ferait donc rien du
// tout : il faut d'abord que le backend et la traduction existent.

type Ton = "clair" | "sombre";

interface Voie {
  href: string;
  /** Surtitre : la condition d'entrée, dite avant le métier. C'est
   *  l'information qui décide si le lecteur reste sur la carte ou passe. */
  acces: string;
  titre: string;
  description: string;
  /** Trois faits vérifiables, jamais trois arguments de vente. */
  faits: string[];
  cta: string;
  ton: Ton;
  /** Un seul `accent` sur l'écran (règle de la primitive Button) : il revient à
   *  la voie de l'écrasante majorité des visiteurs. Les autres CTA sont des
   *  `secondary` — sur Navy plein, le contour blanc de cette variante ressort
   *  déjà nettement, sans un second Or qui dévaluerait le premier. */
  variante: "accent" | "secondary";
  icone: React.ReactNode;
  /** Réserve affichée sous le CTA quand la voie ne s'ouvre pas d'un seul clic. */
  reserve?: React.ReactNode;
}

// ── Tracés SVG ───────────────────────────────────────────────────────────────
// Écrits à la main, jamais une fonte d'icônes tierce : quatre glyphes ne
// justifient pas une dépendance, et `currentColor` les fait suivre la bascule
// clair/sombre sans une seule classe de plus. Le conteneur porte aria-hidden —
// chaque icône double un titre déjà lisible, un lecteur d'écran ne doit pas
// l'annoncer deux fois.
const TRAIT = { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.75 } as const;

function IconeBoutique() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-6 w-6">
      <path {...TRAIT} d="M3.2 9 4.6 4.9A2 2 0 0 1 6.5 3.5h11a2 2 0 0 1 1.9 1.4L20.8 9" />
      <path {...TRAIT} d="M3.2 9h17.6M4.6 9v9.5a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2V9" />
      <path {...TRAIT} d="M9.5 20.5v-5.2h5v5.2" />
    </svg>
  );
}

function IconeRegistre() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-6 w-6">
      <path
        {...TRAIT}
        d="M5 4.5A1.5 1.5 0 0 1 6.5 3H18a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 18 21H6.5A1.5 1.5 0 0 1 5 19.5z"
      />
      <path {...TRAIT} d="M5 7.5h14.5M8.5 11h7M8.5 14.5h7M8.5 18h3.5" />
    </svg>
  );
}

function IconeInstitution() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-6 w-6">
      <path {...TRAIT} d="M2.5 9.5 12 3.5l9.5 6" />
      <path {...TRAIT} d="M5 9.5v9M9.7 9.5v9M14.3 9.5v9M19 9.5v9" />
      <path {...TRAIT} d="M2.5 21h19" />
    </svg>
  );
}

function IconeTerrain() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-6 w-6">
      <path {...TRAIT} d="M19 10.2c0 5.3-7 11.3-7 11.3s-7-6-7-11.3a7 7 0 1 1 14 0Z" />
      <path {...TRAIT} d="M14.2 10a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0Z" />
    </svg>
  );
}

function IconeCoche() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="mt-[3px] h-3.5 w-3.5 shrink-0">
      <path {...TRAIT} d="m3 8.4 3.2 3.1L13 4.5" />
    </svg>
  );
}

// Plafond de commission LU dans plans.ts plutôt que recopié : ce fichier est le
// miroir de COMMISSION_CAP_CENTIMES_BY_TIER côté trust-api, et il porte déjà la
// cicatrice de la plaquette qui annonçait des taux que le code ne prélevait pas.
// Un chiffre affiché ici ne peut plus diverger de celui qu'on facture.
const PLAFOND_FREEMIUM = formatGnf(COMMISSION_CAP_CENTIMES.freemium);

const VOIES: Voie[] = [
  {
    href: "/register",
    acces: "Ouvert à tous — ni NIF ni numéro eTax",
    titre: "Je vends",
    description:
      "Boutique de quartier, SARL, SA ou association : le même parcours pour toutes. Vous choisirez votre forme légale et votre régime fiscal à l’étape suivante.",
    faits: [
      "Émission de factures certifiées sans quota de volume",
      `Commission prélevée à l’encaissement seulement, plafonnée à ${PLAFOND_FREEMIUM}`,
      "Vente au comptoir sur un simple numéro de téléphone",
    ],
    cta: "Créer mon compte",
    ton: "clair",
    variante: "accent",
    icone: <IconeBoutique />,
  },
  {
    href: "/nouveau-cabinet",
    acces: "Ouvert à tous — vérification de l’Ordre ensuite",
    titre: "Je tiens les comptes des autres",
    description:
      "Cabinet comptable, gestionnaire, fiduciaire ou CGA. Créez votre structure, invitez vos collaborateurs, et demandez des mandats à vos clients pour suivre leur facturation depuis un seul écran.",
    faits: [
      "Numéro d’agrément OCAECG facultatif à la création",
      "Le badge « vérifié par l’Ordre » reste éteint jusqu’au contrôle — il ne s’auto-décerne pas",
      "Un mandat par client, accordé par le client, révocable par lui",
    ],
    cta: "Créer mon cabinet",
    ton: "sombre",
    variante: "secondary",
    icone: <IconeRegistre />,
  },
  {
    href: "/login",
    acces: "Accès institutionnel — vérification hors plateforme",
    titre: "J’ordonne la dépense publique",
    description:
      "Ordonnateur, DAF ou contrôleur financier : validez la liquidation des factures adressées à votre administration, et rendez-les finançables pour le fournisseur.",
    faits: [
      "Un compte acheteur public naît « en attente de vérification »",
      "La bascule en « vérifié » est un contrôle humain, sans écran ni endpoint",
      "Tant qu’elle n’a pas eu lieu, aucune validation ne rend une facture finançable",
    ],
    cta: "Se connecter",
    ton: "sombre",
    variante: "secondary",
    icone: <IconeInstitution />,
    reserve: (
      <>
        Cette barrière est délibérée : sans elle, n’importe qui pourrait créer un faux acheteur
        public et s’auto-approuver ses propres factures. Prenez l’attache de facture.gn pour
        l’ouverture de votre compte.
      </>
    ),
  },
  {
    href: "/register",
    acces: "Compte marchand d’abord, code ensuite",
    titre: "J’inscris les autres",
    description:
      "Agent de terrain et parrainage entre marchands. Chaque marchand que vous amenez et qui quitte le palier gratuit déclenche une prime, pour lui comme pour vous.",
    faits: [
      "Code de parrainage à 6 caractères (A-Z, 2-7), lisible à l’oral",
      "Il se saisit après l’inscription, depuis Tableau de bord › Parrainage",
      "Primes versées en crédits de relance, jamais en espèces",
    ],
    cta: "Créer mon compte marchand",
    ton: "clair",
    variante: "secondary",
    icone: <IconeTerrain />,
    reserve: (
      <>
        Le statut d’<em>agent commercial</em> lui-même s’active sur un compte existant, à la main de
        facture.gn — il ne se déclare pas depuis cet écran.
      </>
    ),
  },
];

export default function InscriptionPage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">
          Dites-nous qui vous êtes
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-navy-600 sm:text-base">
          Quatre profils, quatre espaces distincts. Ils n’ont ni les mêmes écrans, ni les mêmes
          droits — choisir juste ici vous évite un parcours qui ne mènerait nulle part.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {VOIES.map((voie) => (
          <CarteVoie key={voie.titre} voie={voie} />
        ))}
      </div>

      <p className="text-center text-sm text-navy-600">
        Vous avez déjà un compte ?{" "}
        <Link href="/login" className="font-semibold text-navy-950 underline underline-offset-2">
          Se connecter
        </Link>
      </p>
    </div>
  );
}

// Une carte par voie. Pas de <Card> : la primitive est blanche par définition
// (« carte blanche sur le fond gris »), et la moitié de ces cartes est Navy
// pleine. Lui ajouter une prop `ton` pour un seul écran ferait porter à toutes
// les cartes de l'application une variante qu'aucune autre n'utilise.
function CarteVoie({ voie }: { voie: Voie }) {
  const sombre = voie.ton === "sombre";

  return (
    <article
      className={[
        "flex flex-col rounded-2xl border p-6 sm:p-7",
        sombre ? "border-navy-800 bg-navy-950" : "border-navy-100 bg-white",
      ].join(" ")}
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className={[
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border",
            sombre ? "border-white/15 bg-white/5 text-or" : "border-navy-100 bg-grey text-navy-950",
          ].join(" ")}
        >
          {voie.icone}
        </span>
        <div className="min-w-0">
          {/* La condition d'accès AVANT le titre : c'est elle qui décide si la
              carte s'adresse au lecteur. En chasse fixe — c'est un libellé de
              régime, pas une phrase. Pas de font-display ici : à 11px elle
              passerait sous le plancher de la charte (§Typographie). */}
          <p
            className={[
              "font-mono text-[11px] font-bold tracking-wide uppercase",
              sombre ? "text-or" : "text-navy-600",
            ].join(" ")}
          >
            {voie.acces}
          </p>
          <h2
            className={[
              "mt-1.5 font-display text-lg font-semibold",
              sombre ? "text-white" : "text-navy-950",
            ].join(" ")}
          >
            {voie.titre}
          </h2>
        </div>
      </div>

      <p className={["mt-4 text-sm leading-relaxed", sombre ? "text-white/75" : "text-navy-600"].join(" ")}>
        {voie.description}
      </p>

      <ul className="mt-5 flex flex-col gap-2.5">
        {voie.faits.map((fait) => (
          <li key={fait} className="flex gap-2.5">
            <span aria-hidden="true" className={sombre ? "text-or" : "text-navy-950"}>
              <IconeCoche />
            </span>
            <span className={["text-sm leading-relaxed", sombre ? "text-white/75" : "text-navy-600"].join(" ")}>
              {fait}
            </span>
          </li>
        ))}
      </ul>

      {/* mt-auto : les CTA s'alignent en bas de la rangée quels que soient les
          textes au-dessus, sans hauteur fixe qui tronquerait à la traduction. */}
      <div className="mt-auto pt-6">
        <ButtonLink href={voie.href} variant={voie.variante} size="lg" className="w-full">
          {voie.cta}
        </ButtonLink>
        {voie.reserve ? (
          <p className={["mt-3 text-xs leading-relaxed", sombre ? "text-white/75" : "text-navy-600"].join(" ")}>
            {voie.reserve}
          </p>
        ) : null}
      </div>
    </article>
  );
}
