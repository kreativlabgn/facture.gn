import type { Metadata } from "next";
import Link from "next/link";
import { chargerConsoleCabinet, type ClientSousMandat } from "@/lib/cabinet";
import { formatDate, formatGnf } from "@/lib/format";
import { practiceMemberRoleLabel, practiceTypeLabel } from "@/lib/practice";
import { requireSessionToken } from "@/lib/session";
import { listMyPractices, type PracticeMemberItem } from "@/lib/trust-api";
import { ButtonLink, Card } from "@/components/ui";

export const metadata: Metadata = { title: "Cabinet — facture.gn" };

// Console du cabinet : les clients sous mandat, leur volume facturé, et
// l'équipe qui les suit.
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

// Ce que le cabinet peut faire CHEZ le client (MandateGrantedRole) — distinct
// du rang du collaborateur DANS la structure (PracticeMemberRole, voir
// practiceMemberRoleLabel).
const GRANTED_ROLE_LABELS: Record<string, string> = {
  accountant_external: "Comptable externe",
  business_manager: "Gestionnaire",
};

export default async function CabinetHomePage() {
  const token = await requireSessionToken();
  const practices = await listMyPractices(token);
  const practice = practices[0];
  // Le layout rend déjà l'écran « Aucun cabinet » dans ce cas : y répondre une
  // seconde fois superposerait deux états vides.
  if (!practice) {
    return null;
  }

  const { clients, equipe, volumeTotal, facturesTotal, totauxPartiels } =
    await chargerConsoleCabinet(token, practice.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
            {practiceTypeLabel(practice.type)}
          </p>
          <h1 className="font-display text-2xl font-bold text-navy-950">{practice.name}</h1>
        </div>
        <ButtonLink href="/cabinet/mandates" variant="accent">
          Demander un mandat
        </ButtonLink>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Chiffre libelle="Clients sous mandat" valeur={String(clients.length)} />
        <Chiffre
          libelle="Volume facturé"
          valeur={formatGnf(volumeTotal)}
          note={
            totauxPartiels
              ? "Incomplet — au moins un client n'a pas pu être chargé."
              : `Sur ${facturesTotal} facture${facturesTotal > 1 ? "s" : ""} émise${facturesTotal > 1 ? "s" : ""}.`
          }
          alerte={totauxPartiels}
        />
        <Chiffre libelle="Collaborateurs" valeur={String(equipe.length)} />
      </div>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-navy-950">
          Entreprises sous mandat
        </h2>
        <Card>
          {clients.length === 0 ? (
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-navy-50 text-left">
                    <Th>Entreprise</Th>
                    <Th>Accès</Th>
                    <Th align="right">Factures</Th>
                    <Th align="right">Volume</Th>
                    <Th align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {clients.map((client) => (
                    <LigneClient key={client.mandat.id} client={client} />
                  ))}
                </tbody>
              </table>
            </div>
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
    <tr>
      <td className="px-5 py-4">
        <span className="font-medium text-navy-950">{mandat.organization.name}</span>
        {mandat.grantedAt ? (
          <span className="mt-0.5 block text-xs text-navy-600">
            Mandat accordé le {formatDate(mandat.grantedAt)}
          </span>
        ) : null}
      </td>
      <td className="px-5 py-4 text-navy-600">
        {GRANTED_ROLE_LABELS[mandat.grantedRole] ?? mandat.grantedRole}
      </td>
      <td className="px-5 py-4 text-right font-mono tabular-nums text-navy-950">
        {indisponible ? <span className="text-navy-600">—</span> : facturesEmises}
      </td>
      <td className="px-5 py-4 text-right font-mono font-bold tabular-nums text-navy-950">
        {/* Zéro serait un mensonge : la lecture a échoué, on ne sait pas. */}
        {indisponible ? (
          <span className="font-normal text-amber-text">indisponible</span>
        ) : (
          formatGnf(volume)
        )}
      </td>
      <td className="px-5 py-4 text-right">
        <Link
          href={`/cabinet/organizations/${mandat.organization.id}`}
          className="rounded-lg px-3 py-1.5 text-xs font-medium text-navy-600 transition hover:bg-navy-50 hover:text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
        >
          Ouvrir
        </Link>
      </td>
    </tr>
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
  alerte = false,
}: {
  libelle: string;
  valeur: string;
  note?: string;
  alerte?: boolean;
}) {
  return (
    <Card>
      <div className="p-5">
        <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">{libelle}</p>
        <p className="mt-1 font-display text-2xl font-bold text-navy-950">{valeur}</p>
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
