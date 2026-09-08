import type { Metadata } from "next";
import { resolveActivePractice } from "@/lib/active-practice";
import { canManagePractice, PRACTICE_TYPE_LABELS, practiceRoleLabel } from "@/lib/cabinet-nav";
import { requireSessionToken } from "@/lib/session";
import { Badge, Card, DataField, EmptyState } from "@/components/ui";
import { ModeReversementForm, PalierForm, modeLabel, palierLabel } from "./ReglagesForms";

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
        <h2 className="mb-1 font-display text-lg font-semibold text-navy-950">Identité</h2>
        <p className="mb-3 max-w-prose text-sm text-navy-600">
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
        <h2 className="mb-1 font-display text-lg font-semibold text-navy-950">
          Palier partenaire
        </h2>
        <p className="mb-3 max-w-prose text-sm text-navy-600">
          Actuellement : <strong className="text-navy-950">{palierLabel(practice.tier)}</strong>.
        </p>
        <Card>
          <div className="p-6">
            <PalierForm tierActuel={practice.tier} />
          </div>
        </Card>
      </section>

      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-navy-950">Reversement</h2>
        <p className="mb-3 max-w-prose text-sm text-navy-600">
          Actuellement : <strong className="text-navy-950">{modeLabel(modeActuel)}</strong>. C&apos;est
          la façon dont vos commissions d&apos;apporteur vous parviennent.
        </p>
        <Card>
          <div className="p-6">
            <ModeReversementForm modeActuel={modeActuel} />
          </div>
        </Card>
      </section>
    </div>
  );
}
