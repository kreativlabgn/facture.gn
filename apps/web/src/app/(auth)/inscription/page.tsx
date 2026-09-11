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

export default function InscriptionPage() {
  return (
    <div className="w-full max-w-4xl">
      <div className="flex flex-col gap-8">
      <div className="max-w-xl">
        <p className="font-mono text-xs font-bold tracking-[0.14em] text-navy-600 uppercase">Le début de votre parcours</p>
        <h1 className="mt-3 font-display text-3xl leading-tight font-bold text-navy-950 sm:text-4xl">
          Choisissez l’espace qui vous ressemble.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-navy-600">
          Chaque métier a son rythme, ses responsabilités et son écran. Nous vous orientons d’abord, puis nous vous accompagnons pas à pas.
        </p>
      </div>

      <div className="grid gap-4">
        <Card className="overflow-hidden border-or">
          <div className="grid gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-end sm:p-7">
            <div>
              <p className="font-mono text-[11px] font-bold tracking-[0.14em] text-navy-600 uppercase">Pour vendre et encaisser</p>
              <h2 className="mt-2 font-display text-xl font-bold text-navy-950">Espace marchand</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-navy-600">Émettez vos factures, partagez-les à vos clients et suivez vos règlements, même quand votre journée ne se passe pas derrière un bureau.</p>
            </div>
            <ButtonLink href="/espace-marchand" variant="accent">Découvrir l’espace marchand</ButtonLink>
          </div>
        </Card>

        <Card>
          <div className="grid gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-end sm:p-7">
            <div>
              <p className="font-mono text-[11px] font-bold tracking-[0.14em] text-navy-600 uppercase">Pour accompagner plusieurs entreprises</p>
              <h2 className="mt-2 font-display text-xl font-bold text-navy-950">Espace cabinet</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-navy-600">Organisez vos mandats, vos collaborateurs et votre portefeuille client depuis un espace pensé pour les professionnels du chiffre.</p>
            </div>
            <ButtonLink href="/espace-cabinet" variant="secondary">Découvrir l’espace cabinet</ButtonLink>
          </div>
        </Card>

        <Card>
          <div className="grid gap-5 p-6 sm:grid-cols-[1fr_auto] sm:items-end sm:p-7">
            <div>
              <p className="font-mono text-[11px] font-bold tracking-[0.14em] text-navy-600 uppercase">Pour régler une facture reçue</p>
              <h2 className="mt-2 font-display text-xl font-bold text-navy-950">Portail client</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-navy-600">Ouvrez la facture qui vous a été adressée, vérifiez-la et réglez-la avec un code reçu par SMS.</p>
            </div>
            <ButtonLink href="/portail/auth" variant="secondary">Accéder à mes factures</ButtonLink>
          </div>
        </Card>
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
    </div>
  );
}
