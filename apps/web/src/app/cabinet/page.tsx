import type { Metadata } from "next";
import Link from "next/link";
import { chargerConsoleCabinet, type ClientSousMandat } from "@/lib/cabinet";
import { formatGnf } from "@/lib/format";
import { resolveActivePractice } from "@/lib/active-practice";
import { canRequestMandate } from "@/lib/cabinet-nav";
import { requireSessionToken } from "@/lib/session";
import { type PracticeMemberItem } from "@/lib/trust-api";
import { ButtonLink, Card, KpiTile } from "@/components/ui";

export const metadata: Metadata = { title: "Cabinet — facture.gn" };

// Vue d'ensemble du cabinet — et RIEN d'autre. Le détail vit chacun sur SA
// page dédiée (barre latérale : Entreprises suivies, Mandats, Collaborateurs,
// Paramètres) ; cet écran ne les recopie plus (voir
// docs/plans/2026-09-16-cabinet-vue-ensemble-dedup.md — cette page portait
// avant deux onglets `?tab=` qui dupliquaient intégralement le portefeuille
// complet et la fiche du cabinet). Dupliquer une table de cent lignes ou une
// fiche d'identité ici n'aiderait personne : soit elle diverge de l'original
// avec le temps, soit elle double la maintenance pour un contenu qui n'ajoute
// rien à « comment va le cabinet ».
//
// AUCUN ENDPOINT D'AGRÉGATION n'existe côté trust-api — pas de
// /practices/dashboard, pas de « volume supervisé » calculé serveur. Les
// chiffres ci-dessous sont composés à partir de routes réelles (voir
// lib/cabinet.ts), au prix d'une requête par client. C'est visible et assumé :
// mieux vaut un compte exact et un peu coûteux qu'un chiffre inventé.
export default async function CabinetHomePage() {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  // Le layout rend déjà l'écran « Aucun cabinet » dans ce cas : y répondre une
  // seconde fois superposerait deux états vides.
  if (!practice) {
    return null;
  }

  const { clients, equipe, volumeTotal, facturesTotal, totauxPartiels } = await chargerConsoleCabinet(
    token,
    practice.id,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Demander un mandat est ouvert à tout membre actif : le scope
          d’accountant_external porte mandate:request (ADR-068/078). Demander
          n'engage rien — c'est l'organisation qui accepte, et qui révoque. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-prose text-sm text-white/75">
          Votre cabinet en un coup d&apos;œil : les entreprises que vous suivez, ce qu&apos;elles
          ont facturé, et l&apos;équipe qui les accompagne.
        </p>
        {canRequestMandate(practice.role) ? (
          <ButtonLink href="/cabinet/mandates" variant="accent" surface="sombre">
            Demander un mandat
          </ButtonLink>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiTile libelle="Entreprises suivies" valeur={String(clients.length)} />
        <KpiTile
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
        <KpiTile libelle="Collaborateurs" valeur={String(equipe.length)} />
      </div>

      <SurveillanceCabinet clients={clients} equipe={equipe} />
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
          href="/cabinet/organizations"
          alerte={sansActivite.length > 0}
        />
        <SignalCabinet
          titre="Données à vérifier"
          description={
            indisponibles.length > 0
              ? `${indisponibles.length} entreprise${indisponibles.length > 1 ? "s" : ""} non chargée${indisponibles.length > 1 ? "s" : ""}`
              : "Toutes les données sont disponibles"
          }
          href="/cabinet/organizations"
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
