// Les trois portes publiques de la plateforme, en UN SEUL endroit. La landing,
// le hub /inscription et le menu « Se connecter » du header lisent tous cette
// table : un libellé ou une cible qui change ici change partout, et le spec
// (espaces.spec.ts) vérifie que chaque cible existe ET n'est pas une route
// protégée.
//
// ── POURQUOI CETTE TABLE EXISTE ──────────────────────────────────────────────
// Avant elle, chaque écran écrivait ses propres href. La landing envoyait le
// marchand vers /inscription, dont la carte renvoyait vers /espace-marchand —
// une route PROTÉGÉE (proxy.ts) : un visiteur sans compte finissait sur
// /login?returnTo=/espace-marchand, c'est-à-dire un formulaire de connexion
// alors qu'il venait s'inscrire. La carte cabinet faisait pareil via
// /espace-cabinet, sans aucune voie de création. Trois identités, trois
// tunnels, mais des boutons qui les confondaient.
//
// ── TROIS IDENTITÉS, PAS TROIS COMPTES ───────────────────────────────────────
//   • marchand — compte (msisdn + mot de passe) puis organisation. Connexion
//     /login ; création /register, qui enchaîne sur /onboarding.
//   • cabinet  — le MÊME type de compte, mais une structure différente
//     (ProfessionalPractice) et une autre console. Connexion /login avec
//     returnTo=/cabinet ; création /register avec returnTo=/nouveau-cabinet :
//     register/actions.ts honore returnTo, donc le tunnel cabinet réutilise le
//     formulaire de compte sans en dupliquer un.
//   • acheteur — AUCUN compte. Un code SMS ouvre le portail (scope
//     client_portal). Une seule action, jamais de « créer un compte » : en
//     proposer un serait un mensonge d'interface.

export type EspaceId = "marchand" | "cabinet" | "acheteur";

export type EspaceAction = {
  label: string;
  href: string;
};

export type Espace = {
  id: EspaceId;
  eyebrow: string;
  titre: string;
  texte: string;
  /** Carte mise en avant (liseré Or). Un seul espace à la fois. */
  accent: boolean;
  /** Entrée pour qui a déjà accès. Toujours présente. */
  connexion: EspaceAction;
  /** Entrée pour qui n'a rien encore. Null pour l'acheteur, qui n'a pas de compte à créer. */
  creation: EspaceAction | null;
  /** Une ligne sous les boutons quand le parcours a une particularité à annoncer. */
  note?: string;
};

export const ESPACES: readonly Espace[] = [
  {
    id: "marchand",
    eyebrow: "Pour votre entreprise",
    titre: "Espace marchand",
    texte: "Émettez vos factures, suivez vos clients et pilotez vos encaissements depuis une interface pensée pour le mobile.",
    accent: true,
    connexion: { label: "Se connecter", href: "/login" },
    creation: { label: "Créer mon compte", href: "/register" },
  },
  {
    id: "cabinet",
    eyebrow: "Pour les professionnels du chiffre",
    titre: "Espace cabinet",
    texte: "Suivez les mandats, les portefeuilles et les écritures de vos entreprises clientes dans un environnement séparé.",
    accent: false,
    connexion: { label: "Se connecter", href: "/login?returnTo=/cabinet" },
    creation: { label: "Inscrire mon cabinet", href: "/register?returnTo=/nouveau-cabinet" },
  },
  {
    id: "acheteur",
    eyebrow: "Pour vos clients",
    titre: "Portail acheteur",
    texte: "Consultez les factures adressées à votre numéro, vérifiez-les et réglez-les après authentification par SMS.",
    accent: false,
    connexion: { label: "Consulter mes factures", href: "/portail/auth" },
    creation: null,
    note: "Sans création de compte : un code reçu par SMS suffit.",
  },
];

/** Le profil majoritaire — cible du CTA principal du header et du hero. */
export const ESPACE_PAR_DEFAUT = ESPACES[0];

/** Libellé court d'un profil dans le menu « Se connecter » du header. */
export const LIBELLE_MENU: Record<EspaceId, string> = {
  marchand: "Connexion marchand",
  cabinet: "Connexion cabinet",
  acheteur: "Portail acheteur",
};
