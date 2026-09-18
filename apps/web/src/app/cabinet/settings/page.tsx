import type { Metadata } from "next";
import { resolveActivePractice } from "@/lib/active-practice";
import {
  canManagePractice,
  modeLabel,
  palierLabel,
  PRACTICE_TYPE_LABELS,
  practiceRoleLabel,
} from "@/lib/cabinet-nav";
import { chargerPartageHonoraires, type PartageHonoraires } from "@/lib/cabinet";
import { formatGnf } from "@/lib/format";
import { requireSessionToken } from "@/lib/session";
import { Badge, Card, DataField, EmptyState, KpiTile } from "@/components/ui";
import { ModeReversementForm, PalierForm } from "./ReglagesForms";

export const metadata: Metadata = { title: "Paramètres du cabinet — facture.gn" };

// Le cabinet lui-même : son identité, son palier partenaire, la façon dont il
// est rémunéré.
//
// L'IDENTITÉ EST EN LECTURE SEULE, faute d'endpoint : trust-api n'expose aucun
// PATCH /practices/:id — seuls le palier et le mode de reversement se changent
// (H3, ADR-071). Afficher un formulaire d'identité qui n'aurait rien pour
// écrire serait pire que de ne rien afficher : l'utilisateur croirait avoir
// enregistré. Ce qui manque est donc dit à l'écran, pas simulé.
export default async function CabinetSettingsPage() {
  const token = await requireSessionToken();
  const { active: practice } = await resolveActivePractice(token);
  if (!practice) {
    return null;
  }

  // Miroir d'assertPracticeAdmin. Masquer n'autorise rien — trust-api refuse de
  // toute façon en 403 ; c'est pour ne pas offrir un bouton qui n'aboutit pas.
  if (!canManagePractice(practice.role)) {
    return (
      <EmptyState
        title="Accès réservé"
        description={`Seul un administrateur du cabinet peut modifier ces réglages. Vous y êtes ${practiceRoleLabel(practice.role).toLowerCase()}.`}
      />
    );
  }

  const modeActuel = practice.revenueShareSettlementMode ?? "payout";

  // Le partage d'honoraires ne se charge qu'ici : cette page entière est déjà
  // réservée à practice_admin (garde ci-dessus), donc un seul appel réseau
  // supplémentaire, jamais un pour un rôle qui ne verra de toute façon pas
  // l'écran.
  const partage = await chargerPartageHonoraires(token, practice.id);

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4 p-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">
              {PRACTICE_TYPE_LABELS[practice.type] ?? practice.type}
            </p>
            <p className="mt-1 font-display text-xl font-bold text-navy-950">{practice.name}</p>
          </div>
          {practice.ordreVerified ? (
            <Badge tone="good">Vérifié par l&apos;Ordre</Badge>
          ) : (
            <Badge tone="navy">Non vérifié</Badge>
          )}
        </div>
      </Card>

      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-white">Identité</h2>
        <p className="mb-3 max-w-prose text-sm text-white/75">
          Ces informations ont été saisies à la création du cabinet et ne sont pas modifiables
          depuis cet écran — contactez-nous pour les corriger.
        </p>
        <Card>
          <dl className="grid grid-cols-1 gap-5 p-6 sm:grid-cols-2">
            <DataField label="Nom">{practice.name}</DataField>
            <DataField label="Type">
              {PRACTICE_TYPE_LABELS[practice.type] ?? practice.type}
            </DataField>
            <DataField label="Numéro d'agrément">
              {practice.registrationNumber ?? <span className="text-navy-600">Non renseigné</span>}
            </DataField>
            <DataField label="Téléphone">
              {practice.phone ?? <span className="text-navy-600">Non renseigné</span>}
            </DataField>
            <DataField label="E-mail">
              {practice.email ?? <span className="text-navy-600">Non renseigné</span>}
            </DataField>
            <DataField label="Votre rôle">{practiceRoleLabel(practice.role)}</DataField>
          </dl>
        </Card>
      </section>

      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-white">
          Palier partenaire
        </h2>
        <p className="mb-3 max-w-prose text-sm text-white/75">
          Actuellement : <strong className="text-white">{palierLabel(practice.tier)}</strong>.
        </p>
        <Card>
          <div className="p-6">
            <PalierForm tierActuel={practice.tier} />
          </div>
        </Card>
      </section>

      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-white">Reversement</h2>
        <p className="mb-3 max-w-prose text-sm text-white/75">
          Actuellement : <strong className="text-white">{modeLabel(modeActuel)}</strong>. C&apos;est
          la façon dont vos commissions d&apos;apporteur vous parviennent.
        </p>
        <Card>
          <div className="p-6">
            <ModeReversementForm modeActuel={modeActuel} />
          </div>
        </Card>
      </section>

      <PartageDHonoraires partage={partage} />
    </div>
  );
}

// Ce que le cabinet touche en amenant ses clients sur la plateforme : 10 % de
// la commission déjà perçue par facture.gn, plafonnés à 5 000 GNF par mois et
// par entreprise (H4/H3, ADR-071). À côté de Palier et Reversement — les
// conditions commerciales du cabinet — parce que c'est le même thème :
// combien le cabinet gagne, comment, et ce qui lui reste dû.
function PartageDHonoraires({ partage }: { partage: PartageHonoraires }) {
  return (
    <section>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-lg font-semibold text-white">Partage d&apos;honoraires</h2>
        <p className="font-mono text-xs text-white/75">{partage.periodMonth}</p>
      </div>

      {partage.indisponible ? (
        <Card>
          <p className="p-6 text-sm text-amber-text">
            Le partage d&apos;honoraires n&apos;a pas pu être chargé. Les montants ci-dessous
            seraient faux — ils ne sont donc pas affichés.
          </p>
        </Card>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <KpiTile
            libelle="Acquis ce mois"
            valeur={formatGnf(partage.crediteCeMois)}
            mono
            note={`Sur ${partage.clientsRemunerateurs} entreprise${partage.clientsRemunerateurs > 1 ? "s" : ""} — 10 % de la commission, plafonnés à 5 000 GNF par entreprise et par mois.`}
          />
          <KpiTile
            libelle="En attente de reversement"
            valeur={formatGnf(partage.enAttente)}
            mono
            note="Toutes périodes confondues."
          />
          <KpiTile
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
