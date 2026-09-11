import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui";
import { EspaceCard } from "@/components/auth/EspaceCard";
import { ComptesDemo } from "@/components/ComptesDemo";
import { ESPACES } from "@/lib/espaces";

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

      {/* Mêmes cartes que la section Espaces de la landing, même source
          (lib/espaces.ts) : deux boutons pour les professionnels, un seul pour
          l'acheteur. Avant, ces cartes renvoyaient vers /espace-marchand et
          /espace-cabinet — deux routes PROTÉGÉES — et un visiteur venu
          s'inscrire finissait sur /login. */}
      <div className="grid gap-4 lg:grid-cols-3">
        {ESPACES.map((espace) => (
          <EspaceCard key={espace.id} espace={espace} heading="h2" />
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

      {/* La vitrine vient APRÈS les portes, jamais avant : un visiteur venu
          s'inscrire doit trouver son parcours en premier écran. Elle est là pour
          celui qui hésite encore — et pour l'audit visuel, qui a besoin d'une
          surface peuplée sans monter une base de données. */}
      <ComptesDemo />

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
