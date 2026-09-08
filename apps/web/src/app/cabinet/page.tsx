import type { Metadata } from "next";
import Link from "next/link";
import { chargerConsoleCabinet, type ClientSousMandat } from "@/lib/cabinet";
import { formatDate, formatGnf } from "@/lib/format";
import { practiceMemberRoleLabel } from "@/lib/practice";
import { resolveActivePractice } from "@/lib/active-practice";
import { canManageMandates } from "@/lib/cabinet-nav";
import { requireSessionToken } from "@/lib/session";
import { type PracticeMemberItem } from "@/lib/trust-api";
import { ButtonLink, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Cabinet — facture.gn" };

// Vue d'ensemble du cabinet : comment il va, et ce qui demande une action.
//
// LE PORTEFEUILLE COMPLET A DÉMÉNAGÉ vers /cabinet/organizations. Un accueil
// doit répondre en un coup d'œil ; une table de deux cents clients ne répond à
// rien. On en garde les cinq plus récents, avec le chemin vers le reste.
//
// AUCUN ENDPOINT D'AGRÉGATION n'existe côté trust-api — pas de
// /practices/dashboard, pas de « volume supervisé » calculé serveur. Les
// chiffres ci-dessous sont composés à partir de trois routes réelles (voir
// lib/cabinet.ts), au prix d'une requête par client. C'est visible et assumé :
// mieux vaut un compte exact et un peu coûteux qu'un chiffre inventé.
//
// Ce qui N'EST PAS affiché, faute de données : le NIF et le régime fiscal des
// clients — le mandat ne remonte que `{ id, name }` de l'organisation — et
// l'e-mail des collaborateurs, `User` n'ayant pas ce champ dans ce dépôt (voir
// schema.prisma : l'identité y est le numéro de téléphone, jamais un e-mail).

const APERCU_MAX = 5;

// Ce que le cabinet peut faire CHEZ le client (MandateGrantedRole) — distinct
// du rang du collaborateur DANS la structure (PracticeMemberRole, voir
// practiceMemberRoleLabel).
const GRANTED_ROLE_LABELS: Record<string, string> = {
  accountant_external: "Comptable externe",
  business_manager: "Gestionnaire",
};

export default async function CabinetHomePage() {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  // Le layout rend déjà l'écran « Aucun cabinet » dans ce cas : y répondre une
  // seconde fois superposerait deux états vides.
  if (!practice) {
    return null;
  }

  const { clients, equipe, volumeTotal, facturesTotal, totauxPartiels } =
    await chargerConsoleCabinet(token, practice.id);

  const apercu = clients.slice(0, APERCU_MAX);
  const reste = clients.length - apercu.length;

  return (
    <div className="flex flex-col gap-6">
      {canManageMandates(practice.role) ? (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-prose text-sm text-navy-600">
            Votre cabinet en un coup d&apos;œil : les entreprises que vous suivez, ce qu&apos;elles
            ont facturé, et l&apos;équipe qui les accompagne.
          </p>
          <ButtonLink href="/cabinet/mandates" variant="accent">
            Demander un mandat
          </ButtonLink>
        </div>
      ) : (
        <p className="max-w-prose text-sm text-navy-600">
          Votre cabinet en un coup d&apos;œil. Demander un mandat engage la structure : seul un
          administrateur du cabinet peut le faire.
        </p>
      )}

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

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold text-navy-950">Entreprises récentes</h2>
          <Link
            href="/cabinet/organizations"
            className="text-sm font-medium text-navy-950 underline underline-offset-2"
          >
            Tout voir
          </Link>
        </div>
        <Card>
          {apercu.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <p className="text-sm text-navy-600">Aucun mandat actif pour le moment.</p>
              <Link
                href="/cabinet/mandates"
                className="text-sm font-medium text-navy-950 underline underline-offset-2"
              >
                Demander un mandat à une entreprise
              </Link>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-navy-50">
                {apercu.map((client) => (
                  <LigneClient key={client.mandat.id} client={client} />
                ))}
              </ul>
              {reste > 0 ? (
                <div className="border-t border-navy-50 px-5 py-3 text-center">
                  <Link
                    href="/cabinet/organizations"
                    className="text-sm font-medium text-navy-950 underline underline-offset-2"
                  >
                    {reste} autre{reste > 1 ? "s" : ""} entreprise{reste > 1 ? "s" : ""}
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </section>

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
                <LigneMembre key={membre.id} membre={membre} />
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function LigneClient({ client }: { client: ClientSousMandat }) {
  const { mandat, facturesEmises, volume, indisponible } = client;

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4">
      <div className="min-w-0">
        <Link
          href={`/cabinet/organizations/${mandat.organization.id}`}
          className="text-sm font-medium text-navy-950 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
        >
          {mandat.organization.name}
        </Link>
        <p className="mt-0.5 text-xs text-navy-600">
          {GRANTED_ROLE_LABELS[mandat.grantedRole] ?? mandat.grantedRole}
          {mandat.grantedAt ? ` · depuis le ${formatDate(mandat.grantedAt)}` : ""}
        </p>
      </div>
      <div className="text-right">
        {/* Zéro serait un mensonge : la lecture a échoué, on ne sait pas. */}
        {indisponible ? (
          <p className="text-sm text-amber-text">indisponible</p>
        ) : (
          <>
            <p className="font-mono text-sm font-bold tabular-nums text-navy-950">
              {formatGnf(volume)}
            </p>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-navy-600">
              {facturesEmises} facture{facturesEmises > 1 ? "s" : ""}
            </p>
          </>
        )}
      </div>
    </li>
  );
}

function LigneMembre({ membre }: { membre: PracticeMemberItem }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-4">
      <span className="text-sm text-navy-950">{membre.user.name}</span>
      <span className="text-xs text-navy-600">{practiceMemberRoleLabel(membre.role)}</span>
    </li>
  );
}

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
