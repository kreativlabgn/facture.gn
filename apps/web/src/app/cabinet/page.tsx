import type { Metadata } from "next";
import Link from "next/link";
import {
  chargerConsoleCabinet,
  chargerPartageHonoraires,
  type ClientSousMandat,
  type PartageHonoraires,
} from "@/lib/cabinet";
import { formatDate, formatGnf } from "@/lib/format";
import { practiceMemberRoleLabel } from "@/lib/practice";
import { resolveActivePractice } from "@/lib/active-practice";
import {
  CABINET_TABS,
  canManagePractice,
  canRequestMandate,
  PRACTICE_TYPE_LABELS,
  resolveCabinetTab,
  type CabinetTab,
} from "@/lib/cabinet-nav";
import { requireSessionToken } from "@/lib/session";
import { type PracticeMemberItem } from "@/lib/trust-api";
import { Badge, ButtonLink, Card, DataField } from "@/components/ui";
import { RevokeMemberForm } from "./members/RevokeMemberForm";

export const metadata: Metadata = { title: "Cabinet — facture.gn" };

// Console du cabinet — deux vues sous une seule adresse.
//
// L'ONGLET EST DANS L'URL (`?tab=`), jamais dans un état React. Trois raisons,
// et la première suffirait : sans JavaScript, un onglet piloté par useState ne
// s'ouvre pas. Ensuite, un lien s'envoie et se met en favori — « regarde la
// ligne de ce client » reste vrai après un rechargement. Enfin, le bouton
// Retour du navigateur refait le chemin inverse, ce qu'un onglet local casse.
//
// AUCUN ENDPOINT D'AGRÉGATION n'existe côté trust-api — pas de
// /practices/dashboard, pas de « volume supervisé » calculé serveur. Les
// chiffres ci-dessous sont composés à partir de routes réelles (voir
// lib/cabinet.ts), au prix d'une requête par client. C'est visible et assumé :
// mieux vaut un compte exact et un peu coûteux qu'un chiffre inventé.
//
// Ce qui N'EST PAS affiché, faute de données : le NIF et le régime fiscal des
// clients — le mandat ne remonte que `{ id, name }` de l'organisation — et
// l'e-mail des collaborateurs, `User` n'ayant pas ce champ dans ce dépôt (voir
// schema.prisma : l'identité y est le numéro de téléphone, jamais un e-mail).

// Ce que le cabinet peut faire CHEZ le client (MandateGrantedRole) — distinct
// du rang du collaborateur DANS la structure (PracticeMemberRole, voir
// practiceMemberRoleLabel).
const GRANTED_ROLE_LABELS: Record<string, string> = {
  accountant_external: "Comptable externe",
  business_manager: "Gestionnaire",
};

const TIER_LABELS: Record<string, string> = {
  partner_free: "Partenaire Free",
  partner_starter: "Partenaire Starter",
  partner_pro: "Partenaire Pro",
  partner_institutional: "Partenaire Institutionnel",
};

export default async function CabinetHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [token, params] = await Promise.all([requireSessionToken(), searchParams]);
  const { active: practice } = await resolveActivePractice(token);
  // Le layout rend déjà l'écran « Aucun cabinet » dans ce cas : y répondre une
  // seconde fois superposerait deux états vides.
  if (!practice) {
    return null;
  }

  const onglet = resolveCabinetTab(params.tab);

  // Le partage d'honoraires ne sert qu'à l'onglet « Le cabinet » : le charger
  // sur le portefeuille ajouterait deux appels réseau à un écran qui en fait
  // déjà un par client.
  const [console_, partage] = await Promise.all([
    chargerConsoleCabinet(token, practice.id),
    onglet === "structure"
      ? chargerPartageHonoraires(token, practice.id)
      : Promise.resolve(null),
  ]);
  const { clients, equipe, volumeTotal, facturesTotal, totauxPartiels } = console_;

  return (
    <div className="flex flex-col gap-6">
      {/* Demander un mandat est ouvert à tout membre actif : le scope
          d’accountant_external porte mandate:request (ADR-068/078). Demander
          n'engage rien — c'est l'organisation qui accepte, et qui révoque. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-prose text-sm text-navy-600">
          Votre cabinet en un coup d&apos;œil : les entreprises que vous suivez, ce qu&apos;elles
          ont facturé, et l&apos;équipe qui les accompagne.
        </p>
        {canRequestMandate(practice.role) ? (
          <ButtonLink href="/cabinet/mandates" variant="accent">
            Demander un mandat
          </ButtonLink>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Chiffre libelle="Entreprises suivies" valeur={String(clients.length)} />
        <Chiffre
          libelle="Volume facturé"
          valeur={formatGnf(volumeTotal)}
          mono
          note={
            totauxPartiels
              ? "Incomplet — au moins une entreprise n'a pas pu être chargée."
              : `Sur ${facturesTotal} facture${facturesTotal > 1 ? "s" : ""} émise${facturesTotal > 1 ? "s" : ""}.`
          }
          alerte={totauxPartiels}
        />
        <Chiffre libelle="Collaborateurs" valeur={String(equipe.length)} />
      </div>

      <SurveillanceCabinet clients={clients} equipe={equipe} />

      <Onglets actif={onglet} />

      {onglet === "portefeuille" ? (
        <Portefeuille clients={clients} />
      ) : (
        <Structure
          practice={practice}
          equipe={equipe}
          partage={partage}
          administre={canManagePractice(practice.role)}
        />
      )}
    </div>
  );
}

function SurveillanceCabinet({
  clients,
  equipe,
}: {
  clients: readonly ClientSousMandat[];
  equipe: readonly PracticeMemberItem[];
}) {
  const sansActivite = clients.filter((client) => !client.indisponible && client.facturesEmises === 0);
  const indisponibles = clients.filter((client) => client.indisponible);
  const equipeVide = equipe.length === 0;

  return (
    <section aria-labelledby="surveillance-cabinet">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="surveillance-cabinet" className="font-display text-base font-semibold text-navy-950">
          À surveiller
        </h2>
        <span className="text-xs text-navy-600">Signaux issus de vos données disponibles</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <SignalCabinet
          titre="Entreprises sans activité"
          description={
            sansActivite.length > 0
              ? `${sansActivite.length} entreprise${sansActivite.length > 1 ? "s" : ""} sans facture émise`
              : "Toutes les entreprises ont une activité"
          }
          href="/cabinet"
          alerte={sansActivite.length > 0}
        />
        <SignalCabinet
          titre="Données à vérifier"
          description={
            indisponibles.length > 0
              ? `${indisponibles.length} entreprise${indisponibles.length > 1 ? "s" : ""} non chargée${indisponibles.length > 1 ? "s" : ""}`
              : "Toutes les données sont disponibles"
          }
          href="/cabinet"
          alerte={indisponibles.length > 0}
        />
        <SignalCabinet
          titre="Équipe du cabinet"
          description={equipeVide ? "Vous êtes seul pour le moment" : `${equipe.length} collaborateur${equipe.length > 1 ? "s" : ""}`}
          href="/cabinet/members"
          alerte={equipeVide}
        />
      </div>
    </section>
  );
}

function SignalCabinet({
  titre,
  description,
  href,
  alerte,
}: {
  titre: string;
  description: string;
  href: string;
  alerte: boolean;
}) {
  return (
    <Card className={alerte ? "border-amber-text/40" : undefined}>
      <Link
        href={href}
        className="block p-5 transition-colors hover:bg-navy-50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy-950"
      >
        <h3 className="font-display text-sm font-semibold text-navy-950">{titre}</h3>
        <p className={alerte ? "mt-1 text-xs text-amber-text" : "mt-1 text-xs text-navy-600"}>{description}</p>
      </Link>
    </Card>
  );
}

// Des LIENS, jamais des boutons : changer d'onglet est une navigation, elle
// s'annonce comme telle au lecteur d'écran et s'ouvre dans un onglet du
// navigateur si on le demande. L'état actif est porté par trois signaux — le
// poids, le rail sous l'entrée, et aria-current — jamais par la seule couleur
// (WCAG 1.4.1).
function Onglets({ actif }: { actif: CabinetTab }) {
  return (
    <nav aria-label="Sections du cabinet" className="border-b border-navy-100">
      <ul className="-mb-px flex gap-1">
        {CABINET_TABS.map((onglet) => {
          const estActif = onglet.cle === actif;
          return (
            <li key={onglet.cle}>
              <Link
                href={`/cabinet?tab=${onglet.cle}`}
                aria-current={estActif ? "page" : undefined}
                className={[
                  "inline-flex min-h-[44px] items-center border-b-2 px-4 font-display text-sm font-semibold transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950",
                  estActif
                    ? "border-navy-950 text-navy-950"
                    : "border-transparent text-navy-600 hover:text-navy-950",
                ].join(" ")}
              >
                {onglet.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ── Onglet « Portefeuille » ──────────────────────────────────────────────────

function Portefeuille({ clients }: { clients: readonly ClientSousMandat[] }) {
  if (clients.length === 0) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <p className="text-sm text-navy-600">Aucun mandat actif pour le moment.</p>
          <Link
            href="/cabinet/mandates"
            className="text-sm font-medium text-navy-950 underline underline-offset-2"
          >
            Demander un mandat à une entreprise
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-lg font-semibold text-navy-950">Entreprises sous mandat</h2>
        {/* L'encours est un MAJORANT : une facture partiellement réglée y pèse
            pour son montant plein, GET /invoices ne rendant pas la part déjà
            payée. Le dire ici plutôt que de laisser lire un solde exact. */}
        <p className="text-xs text-navy-600">
          L&apos;encours compte les factures partiellement réglées en entier.
        </p>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-navy-50 text-left">
                <Th>Entreprise</Th>
                <Th>Accès accordé</Th>
                <Th align="right">Encaissé</Th>
                <Th align="right">Encours</Th>
                <Th align="right">Écritures</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-50">
              {clients.map((client) => (
                <LigneClient key={client.mandat.id} client={client} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </section>
  );
}

function LigneClient({ client }: { client: ClientSousMandat }) {
  const { mandat, facturesEmises, encaisse, encours, indisponible } = client;

  return (
    <tr>
      <td className="px-5 py-4">
        <Link
          href={`/cabinet/organizations/${mandat.organization.id}`}
          className="font-medium text-navy-950 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
        >
          {mandat.organization.name}
        </Link>
        <span className="mt-0.5 block text-xs text-navy-600">
          {indisponible
            ? "Factures indisponibles"
            : `${facturesEmises} facture${facturesEmises > 1 ? "s" : ""} émise${facturesEmises > 1 ? "s" : ""}`}
          {mandat.grantedAt ? ` · depuis le ${formatDate(mandat.grantedAt)}` : ""}
        </span>
      </td>
      <td className="px-5 py-4 text-navy-600">
        {GRANTED_ROLE_LABELS[mandat.grantedRole] ?? mandat.grantedRole}
      </td>
      {/* Zéro serait un mensonge : la lecture a échoué, on ne sait pas. */}
      <td className="px-5 py-4 text-right font-mono tabular-nums text-navy-950">
        {indisponible ? <span className="text-amber-text">indisponible</span> : formatGnf(encaisse)}
      </td>
      <td className="px-5 py-4 text-right font-mono font-bold tabular-nums text-navy-950">
        {indisponible ? <span className="font-normal text-amber-text">—</span> : formatGnf(encours)}
      </td>
      <td className="px-5 py-4 text-right">
        {/* Le FEC (Fichier des Écritures Comptables, format OHADA) passe par un
            Route Handler : un <a href> ne peut pas porter d'en-tête
            Authorization, et le token ne doit de toute façon jamais atteindre
            le navigateur.

            prefetch={false} : sans lui, Next préchargerait la route au survol —
            c'est-à-dire génèrerait l'export comptable complet d'un client parce
            que la souris est passée sur la ligne. */}
        <Link
          prefetch={false}
          href={`/cabinet/organizations/${mandat.organization.id}/fec`}
          className="inline-flex min-h-[36px] items-center rounded-lg px-3 text-xs font-medium text-navy-600 transition hover:bg-navy-50 hover:text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
          aria-label={`Télécharger le FEC de ${mandat.organization.name}`}
        >
          FEC
        </Link>
      </td>
    </tr>
  );
}

// ── Onglet « Le cabinet » ────────────────────────────────────────────────────

function Structure({
  practice,
  equipe,
  partage,
  administre,
}: {
  practice: {
    name: string;
    type: string;
    role: string;
    tier: string;
    registrationNumber?: string | null;
    ordreVerified?: boolean;
    phone?: string | null;
    email?: string | null;
  };
  equipe: readonly PracticeMemberItem[];
  partage: PartageHonoraires | null;
  administre: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-navy-950">Fiche du cabinet</h2>
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-navy-50 px-6 py-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
                {PRACTICE_TYPE_LABELS[practice.type] ?? practice.type}
              </p>
              <p className="mt-1 font-display text-xl font-bold text-navy-950">{practice.name}</p>
            </div>
            {/* Le badge de l'Ordre n'est posé que s'il est VRAI. L'afficher par
                commodité serait une fausse déclaration ; son absence, elle, ne
                dit rien de négatif — elle ne dit simplement rien. */}
            {practice.ordreVerified ? <Badge tone="good">Vérifié par l&apos;Ordre</Badge> : null}
          </div>
          <dl className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2">
            <DataField label="Numéro d'agrément">
              {practice.registrationNumber ?? <span className="text-navy-600">Non renseigné</span>}
            </DataField>
            <DataField label="Palier partenaire">
              {TIER_LABELS[practice.tier] ?? practice.tier}
            </DataField>
            <DataField label="Téléphone">
              {practice.phone ?? <span className="text-navy-600">Non renseigné</span>}
            </DataField>
            <DataField label="E-mail">
              {practice.email ?? <span className="text-navy-600">Non renseigné</span>}
            </DataField>
          </dl>
        </Card>
      </section>

      {partage ? <PartageDHonoraires partage={partage} /> : null}

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold text-navy-950">Collaborateurs</h2>
          <Link
            href="/cabinet/members"
            className="text-sm font-medium text-navy-950 underline underline-offset-2"
          >
            Gérer
          </Link>
        </div>
        <Card>
          {equipe.length === 0 ? (
            <p className="p-8 text-center text-sm text-navy-600">
              Vous êtes seul sur ce cabinet pour l&apos;instant.
            </p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {equipe.map((membre) => (
                <LigneMembre key={membre.id} membre={membre} administre={administre} />
              ))}
            </ul>
          )}
        </Card>
        {administre ? (
          <p className="mt-2 max-w-prose text-xs text-navy-600">
            Retirer un collaborateur coupe d&apos;un coup ses accès à TOUTES les entreprises sous
            mandat : le mandat est accordé au cabinet, jamais à une personne. Le retrait d&apos;un
            administrateur se fait depuis l&apos;écran Collaborateurs.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function PartageDHonoraires({ partage }: { partage: PartageHonoraires }) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-lg font-semibold text-navy-950">Partage d&apos;honoraires</h2>
        <p className="font-mono text-xs text-navy-600">{partage.periodMonth}</p>
      </div>

      {partage.indisponible ? (
        <Card>
          <p className="p-6 text-sm text-amber-text">
            Le partage d&apos;honoraires n&apos;a pas pu être chargé. Les montants ci-dessous
            seraient faux — ils ne sont donc pas affichés.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Chiffre
            libelle="Acquis ce mois"
            valeur={formatGnf(partage.crediteCeMois)}
            mono
            note={`Sur ${partage.clientsRemunerateurs} entreprise${partage.clientsRemunerateurs > 1 ? "s" : ""} — 10 % de la commission, plafonnés à 5 000 GNF par entreprise et par mois.`}
          />
          <Chiffre
            libelle="En attente de reversement"
            valeur={formatGnf(partage.enAttente)}
            mono
            note="Toutes périodes confondues."
          />
          <Chiffre
            libelle="Abonnement du mois"
            valeur={
              partage.abonnementRestantDu === null
                ? "Sur devis"
                : formatGnf(partage.abonnementRestantDu)
            }
            mono={partage.abonnementRestantDu !== null}
            note={
              partage.abonnementRestantDu === null
                ? "Palier institutionnel — le prix est négocié, pas grillé."
                : "Reste dû, déjà net des crédits si vous êtes en déduction."
            }
          />
        </div>
      )}
    </section>
  );
}

function LigneMembre({
  membre,
  administre,
}: {
  membre: PracticeMemberItem;
  administre: boolean;
}) {
  // Le retrait n'est offert que sur les rôles opérationnels. Retirer un
  // ADMINISTRATEUR engage davantage — le serveur refuse de retirer le dernier,
  // et un cabinet sans administrateur ne peut plus ni inviter, ni mandater :
  // ce geste-là reste sur l'écran Collaborateurs, qui l'expose entièrement.
  //
  // Masquer n'autorise rien de toute façon : assertPracticeAdmin garde la route
  // côté trust-api, c'est pour ne pas offrir un bouton qui mène à un 403.
  const retirable = administre && membre.role !== "practice_admin";

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-navy-950">{membre.user.name}</p>
        <p className="mt-0.5 text-xs text-navy-600">{practiceMemberRoleLabel(membre.role)}</p>
      </div>
      {retirable ? (
        <RevokeMemberForm memberUserId={membre.user.id} nom={membre.user.name} />
      ) : null}
    </li>
  );
}

// ── Primitives locales ───────────────────────────────────────────────────────

function Chiffre({
  libelle,
  valeur,
  note,
  mono = false,
  alerte = false,
}: {
  libelle: string;
  valeur: string;
  note?: string;
  mono?: boolean;
  alerte?: boolean;
}) {
  return (
    <Card>
      <div className="p-5">
        <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">{libelle}</p>
        <p
          className={`mt-1 text-2xl font-bold text-navy-950 ${mono ? "font-mono tabular-nums" : "font-display"}`}
        >
          {valeur}
        </p>
        {note ? (
          <p className={`mt-1 text-xs ${alerte ? "text-amber-text" : "text-navy-600"}`}>{note}</p>
        ) : null}
      </div>
    </Card>
  );
}

function Th({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      className={`px-5 py-3 text-xs font-semibold tracking-wide text-navy-600 uppercase ${align === "right" ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}
