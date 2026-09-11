import type { Metadata } from "next";
import Link from "next/link";
import { resolveActivePractice } from "@/lib/active-practice";
import { chargerConsoleCabinet, type ClientSousMandat } from "@/lib/cabinet";
import { formatDate, formatGnf } from "@/lib/format";
import { requireSessionToken } from "@/lib/session";
import { ButtonLink, Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Entreprises suivies — facture.gn" };

// Le portefeuille complet du cabinet, sorti de la vue d'ensemble : passé une
// dizaine de clients, une table de 200 lignes n'a rien à faire sur un écran
// d'accueil qui doit d'abord répondre « comment va le cabinet ».
//
// Ce que le cabinet peut faire CHEZ le client (MandateGrantedRole) — distinct
// du rang du collaborateur DANS la structure (PracticeMemberRole).
const GRANTED_ROLE_LABELS: Record<string, string> = {
  accountant_external: "Comptable externe",
  business_manager: "Gestionnaire",
};

export default async function CabinetOrganizationsPage() {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  // Le layout rend déjà l'écran « Aucun cabinet » : y répondre une seconde fois
  // superposerait deux états vides.
  if (!practice) {
    return null;
  }

  const { clients, volumeTotal, facturesTotal, totauxPartiels } = await chargerConsoleCabinet(
    token,
    practice.id,
  );

  if (clients.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <EnTete />
        <EmptyState
          title="Aucune entreprise suivie"
          description="Un mandat vous est accordé par l'entreprise elle-même : demandez-le avec son NIF, elle valide depuis son tableau de bord."
        />
        <div>
          <ButtonLink href="/cabinet/mandates" variant="accent" surface="sombre">
            Demander un mandat
          </ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <EnTete />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Chiffre libelle="Entreprises" valeur={String(clients.length)} />
        <Chiffre
          libelle="Factures émises"
          valeur={totauxPartiels ? "—" : String(facturesTotal)}
          mono
        />
        <Chiffre
          libelle="Volume facturé"
          valeur={formatGnf(volumeTotal)}
          mono
          note={totauxPartiels ? "Incomplet — au moins une entreprise n'a pas pu être chargée." : undefined}
          alerte={totauxPartiels}
        />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-navy-50 text-left">
                <Th>Entreprise</Th>
                <Th>Accès accordé</Th>
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
      </Card>
    </div>
  );
}

function EnTete() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <p className="max-w-prose text-sm text-white/75">
        Les entreprises qui vous ont accordé un mandat actif. Ouvrir une fiche vous donne accès à
        ses factures, dans la limite du rôle qu&apos;elle vous a accordé.
      </p>
      <ButtonLink href="/cabinet/mandates" variant="secondary" surface="sombre">
        Demander un mandat
      </ButtonLink>
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
          className={`mt-1 text-xl font-bold text-navy-950 ${mono ? "font-mono tabular-nums" : "font-display"}`}
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
