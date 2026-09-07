import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Créer un compte — facture.gn" };

// Porte d'entrée unique : elle aiguille vers les QUATRE publics de la
// plateforme, qui n'ont ni les mêmes écrans, ni les mêmes identités, ni les
// mêmes droits.
//
//   • Le marchand      — OrganizationMember, mot de passe, coquille /dashboard
//   • Le cabinet       — PracticeMember, concept d'appartenance SÉPARÉ
//                        (schema.prisma), coquille /cabinet
//   • L'acheteur       — token scope:"client_portal" obtenu par OTP, aucune
//                        organisation, coquille /portail
//   • L'agent terrain  — marchand doté d'isCommercialAgent, qui inscrit LES
//                        AUTRES
//
// Les confondre était le vrai problème : un cabinet qui créait « un compte »
// atterrissait dans l'onboarding PME, et un acheteur n'avait aucune porte.
//
// PAS DE SÉLECTEUR DE LANGUE, contrairement à la maquette. L'enum
// PreferredLanguage existe bien en base (fr, pular, malinke, soussou), mais
// AUCUNE route ne l'accepte — ni POST /auth/register, ni POST /organizations —
// et apps/web n'a aucune plomberie i18n. Un sélecteur ne ferait donc rien du
// tout : il faut d'abord que le backend et la traduction existent.

interface Voie {
  href: string;
  titre: string;
  description: string;
  cta: string;
}

// Le marchand d'abord : c'est la voie de l'écrasante majorité des visiteurs.
const PRINCIPALE: Voie = {
  href: "/register",
  titre: "Je vends — commerce, entreprise ou association",
  description:
    "Boutique de quartier, SARL, SA ou association : le même parcours pour toutes. Vous choisirez votre forme légale et votre régime fiscal à l'étape suivante, et vous pourrez facturer sans NIF ni numéro eTax.",
  cta: "Créer mon compte",
};

const AUTRES: Voie[] = [
  {
    href: "/nouveau-cabinet",
    titre: "Je suis cabinet comptable, gestionnaire, fiduciaire ou CGA",
    description:
      "Créez votre structure, invitez vos collaborateurs, et demandez des mandats à vos clients pour suivre leur facturation depuis un seul écran.",
    cta: "Créer mon cabinet",
  },
  {
    href: "/portail/auth",
    titre: "J'ai reçu une facture",
    description:
      "Consultez et réglez les factures qui vous ont été adressées. Pas de compte à créer : un code par SMS sur le numéro auquel la facture est adressée suffit.",
    cta: "Accéder à mes factures",
  },
];

export default function InscriptionPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Bienvenue sur facture.gn</h1>
        <p className="mt-2 text-sm leading-relaxed text-navy-600">
          Dites-nous qui vous êtes — chaque profil a son espace.
        </p>
      </div>

      {/* Voie principale, mise en avant : l'accent Or, une seule fois. */}
      <Card>
        <div className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="font-display text-base font-semibold text-navy-950">{PRINCIPALE.titre}</h2>
            <p className="mt-1 text-sm leading-relaxed text-navy-600">{PRINCIPALE.description}</p>
          </div>
          <ButtonLink href={PRINCIPALE.href} variant="accent" size="lg">
            {PRINCIPALE.cta}
          </ButtonLink>
        </div>
      </Card>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-navy-100" />
        <span className="text-xs text-navy-600">ou</span>
        <span className="h-px flex-1 bg-navy-100" />
      </div>

      <div className="flex flex-col gap-4">
        {AUTRES.map((voie) => (
          <Card key={voie.href}>
            <div className="flex flex-col gap-3 p-6">
              <div>
                <h2 className="font-display text-base font-semibold text-navy-950">{voie.titre}</h2>
                <p className="mt-1 text-sm leading-relaxed text-navy-600">{voie.description}</p>
              </div>
              <ButtonLink href={voie.href} variant="secondary">
                {voie.cta}
              </ButtonLink>
            </div>
          </Card>
        ))}
      </div>

      {/* L'agent terrain n'a PAS de voie d'inscription, et c'est voulu :
          isCommercialAgent s'octroie par POST /auth/commercial-agents/:userId/
          grant, protégé par une clé interne (CommercialAgentAuthGuard). On ne
          se déclare pas agent, on l'est fait — donc on renvoie vers la
          connexion plutôt que vers un formulaire qui échouerait. */}
      <Card>
        <div className="p-5">
          <h2 className="font-display text-sm font-semibold text-navy-950">
            Je suis agent commercial terrain
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-navy-600">
            Votre statut d&apos;agent est activé par facture.gn sur un compte existant — il ne se
            crée pas depuis cet écran. Connectez-vous avec le compte qui vous a été communiqué ;
            l&apos;inscription assistée d&apos;un marchand s&apos;y trouve.
          </p>
          <Link
            href="/login"
            className="mt-3 inline-block text-sm font-medium text-navy-950 underline underline-offset-2"
          >
            Se connecter
          </Link>
        </div>
      </Card>

      <p className="text-center text-sm text-navy-600">
        Vous avez déjà un compte ?{" "}
        <Link href="/login" className="font-semibold text-navy-950 underline underline-offset-2">
          Se connecter
        </Link>
      </p>
    </div>
  );
}
