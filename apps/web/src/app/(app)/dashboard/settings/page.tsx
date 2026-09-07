import type { Metadata } from "next";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { getOrganization, getTrustScore, TrustApiError } from "@/lib/trust-api";
import { formatGnf } from "@/lib/format";
import { formatVerifiedPaymentRatio } from "@/lib/kpi";
import { ButtonLink, Card, CardBody, DataField, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Paramètres — facture.gn" };

const REGIME_LABELS: Record<string, string> = {
  normal_tva: "Normal TVA",
  tpu: "TPU",
  normal_sans_tva: "Normal sans TVA",
  non_assujetti_association: "Non assujetti (association)",
};

export default async function SettingsPage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  // GET /organizations/:id et GET /organizations/:id/trust-score sont tous deux
  // réservés owner/admin — même garde 403, un seul message d'erreur pour les deux.
  let detail;
  let trustScore;
  try {
    [detail, trustScore] = await Promise.all([
      getOrganization(token, organization.id),
      getTrustScore(token, organization.id),
    ]);
  } catch (error) {
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <EmptyState
          title="Accès réservé"
          description="Seuls les propriétaires et administrateurs de l'organisation peuvent consulter les paramètres."
        />
      );
    }
    throw error;
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-navy-950">Paramètres</h1>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/dashboard/settings/organisation" variant="secondary">
            Modifier la fiche
          </ButtonLink>
          <ButtonLink href="/dashboard/abonnement" variant="secondary">
            Abonnement
          </ButtonLink>
        </div>
      </div>

      <Card className="mb-6">
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DataField label="Nom">{detail.name}</DataField>
            <DataField label="Régime fiscal">{REGIME_LABELS[detail.regimeFiscal] ?? detail.regimeFiscal}</DataField>
            <DataField label="NIF">{detail.nif ?? "Non renseigné"}</DataField>
            <DataField label="RCCM">{detail.rccm ?? "Non renseigné"}</DataField>
            <DataField label="Palier">{detail.commercialTier}</DataField>
            <DataField label="Vérification DGI">
              {detail.dgiVerificationStatus === "verified" ? "Vérifiée" : "Non vérifiée"}
            </DataField>
          </dl>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardBody>
          <p className="mb-2 font-display text-sm font-semibold text-navy-950">Paiements vérifiés</p>
          {trustScore.ratio === null ? (
            <p className="text-sm text-navy-600">Pas encore de paiement enregistré.</p>
          ) : (
            <>
              {/* Le chiffre est une donnée, pas un titre — même famille que les
                  montants et la tuile équivalente de l'accueil (KpiRow). */}
              <p className="font-mono text-2xl font-bold text-navy-950">
                {formatVerifiedPaymentRatio(trustScore.ratio)}
              </p>
              <p className="mt-1 text-sm text-navy-600">
                {formatGnf(trustScore.verifiedAmount)} vérifiés sur {formatGnf(trustScore.totalAmount)} encaissés
              </p>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <p className="mb-2 font-display text-sm font-semibold text-navy-950">Export FEC</p>
          <p className="mb-4 text-sm text-navy-600">Fichier des écritures comptables (OHADA/SYSCOHADA).</p>
          {/* Porte sur l'organisation ACTIVE, comme les écrans ci-dessus — voir
              settings/fec/route.ts, qui résout la même organisation. */}
          <ButtonLink href="/dashboard/settings/fec">Télécharger le FEC</ButtonLink>
        </CardBody>
      </Card>
    </div>
  );
}
