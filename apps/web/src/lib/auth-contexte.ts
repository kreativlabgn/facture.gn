import type { EspaceId } from "./espaces";

// Ce que la zone d'information d'AuthLayout raconte, par profil. UNE source,
// comme lib/espaces.ts pour les portes : le texte d'une tuile change ici et
// nulle part ailleurs.
//
// RÈGLE D'ÉCRITURE : chaque tuile décrit quelque chose que la plateforme FAIT
// aujourd'hui, avec le mot du produit. Pas de « relances automatiques » tant
// que la relance est un geste du marchand (InvoicesService.sendReminder), pas
// de « facture en un clic » quand il en faut trois (émettre, partager, suivre).
// Une page de connexion qui promet plus que l'écran suivant est le premier
// endroit où un commerçant apprend à ne pas nous croire — la vitrine porte
// déjà la cicatrice du 1,1 % annoncé pour 1,50 % prélevé.

export type AuthTuile = {
  titre: string;
  texte: string;
  /** Étape numérotée (parcours acheteur) plutôt qu'avantage. */
  numero?: string;
  /** Tuile large : occupe deux colonnes sur la grille en tuiles. Posée pour
   *  que chaque grille se FERME (2×2, ou large / 2 / large) — jamais une
   *  case vide en bout de rangée. */
  large?: boolean;
};

export type AuthContexte = {
  eyebrow: string;
  titre: string;
  accroche: string;
  tuiles: AuthTuile[];
  /** Lien secondaire sous les tuiles — aide, démonstration, vérification. */
  lien?: { label: string; href: string };
};

export const AUTH_CONTEXTES: Record<EspaceId, AuthContexte> = {
  acheteur: {
    eyebrow: "Portail acheteur",
    titre: "Vos factures, sans compte à créer.",
    accroche:
      "Le numéro auquel une facture a été adressée suffit à l'ouvrir. Trois étapes, et aucun mot de passe à retenir.",
    tuiles: [
      {
        numero: "1",
        titre: "Identifiez-vous",
        texte: "Saisissez le numéro de téléphone sur lequel vous recevez vos factures.",
      },
      {
        numero: "2",
        titre: "Recevez un code SMS",
        texte: "Un code à quatre chiffres, valable cinq minutes. Rien d'autre ne vous sera demandé.",
      },
      {
        numero: "3",
        titre: "Consultez et réglez",
        texte: "Vérifiez la facture, son émetteur et son montant, puis payez par Mobile Money.",
      },
      {
        titre: "Vos données restent à vous",
        texte:
          "Seul le numéro destinataire peut ouvrir une facture. Aucun mot de passe n'est stocké, et votre session se referme d'elle-même.",
      },
    ],
    lien: { label: "Questions fréquentes", href: "/portail/aide" },
  },
  marchand: {
    eyebrow: "Espace marchand",
    titre: "Facturez, encaissez, prouvez.",
    accroche: "Chaque facture émise garde sa preuve, de l'émission au règlement — et vos clients peuvent la vérifier sans compte.",
    tuiles: [
      {
        titre: "Facture certifiée en trois étapes",
        texte: "Émettez depuis le web ou le canal USSD *620#, partagez un lien, suivez l'état du document.",
        large: true,
      },
      {
        titre: "Encaissements suivis",
        texte: "Lien de paiement Mobile Money, virement, espèces : chaque règlement s'impute sur la facture.",
      },
      {
        titre: "Relance en un geste",
        texte: "Une facture en retard se relance depuis sa fiche, avec le lien de paiement déjà dedans.",
      },
      {
        titre: "Preuve vérifiable publiquement",
        texte: "Un identifiant par facture, contrôlable par n'importe qui sans accès à votre espace.",
        large: true,
      },
    ],
    lien: { label: "Vérifier une facture", href: "/#verification" },
  },
  cabinet: {
    eyebrow: "Espace cabinet",
    titre: "Tous vos mandants, une seule console.",
    accroche: "Un environnement séparé de la PME, pensé pour qui suit plusieurs entreprises à la fois.",
    tuiles: [
      {
        titre: "Mandats multi-entreprises",
        texte: "Chaque mandat actif ouvre le portefeuille et les écritures de l'entreprise concernée, et rien d'autre.",
        large: true,
      },
      {
        titre: "Export comptable FEC",
        texte: "Le fichier des écritures comptables se télécharge par entreprise et par exercice.",
      },
      {
        titre: "Collaborateurs invités",
        texte: "Vous administrez le cabinet et invitez votre équipe ; chacun voit les mêmes mandats que le cabinet.",
      },
      {
        titre: "Cloisonné en base",
        texte: "L'isolation entre organisations est appliquée par PostgreSQL sous chaque requête, mandat compris.",
        large: true,
      },
    ],
    lien: { label: "Voir la démonstration cabinet", href: "/demo/cabinet" },
  },
};

/** Devine le profil depuis la destination après connexion. Le tunnel cabinet
 *  arrive avec `returnTo=/cabinet` ou `/nouveau-cabinet` ; tout le reste est
 *  marchand — le profil majoritaire, et le seul pour qui /dashboard a un sens. */
export function profilDepuisReturnTo(returnTo: string | undefined): Exclude<EspaceId, "acheteur"> {
  return returnTo === "/cabinet" || returnTo === "/nouveau-cabinet" || returnTo?.startsWith("/cabinet/")
    ? "cabinet"
    : "marchand";
}
