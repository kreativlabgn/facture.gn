import type { Metadata } from "next";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { formatGnf } from "@/lib/format";
import {
  COMMISSION_BPS,
  COMMISSION_CAP_CENTIMES,
  PRIX_MENSUEL_CENTIMES,
  TIER_ORDER,
  avantagesDuPalier,
  pourcentage,
  tierIndex,
  tierLabel,
  totalPayeurBps,
  type Tier,
} from "@/lib/plans";
import { requireSessionToken } from "@/lib/session";
import { Badge, Card, EmptyState } from "@/components/ui";
import { getOrganization, TrustApiError } from "@/lib/trust-api";

export const metadata: Metadata = { title: "Abonnement — facture.gn" };

// Ce que chaque palier ouvre, et où se situe l'organisation.
//
// LES TAUX AFFICHÉS SONT CEUX QUE LE CODE PRÉLÈVE, pas ceux de la plaquette.
// La grille produit en circulation annonçait 1,6 / 1,1 / 0,8 / 0,6 % alors que
// commission-grid.ts prélève 2,00 / 1,50 / 1,20 / 1,00 % — elle datait d'avant
// la correction du frais Djomy et n'avait pas été mise à jour. lib/plans.spec.ts
// confronte désormais les deux à chaque exécution des tests : un écart ne peut
// plus être livré.
//
// Les PLAFONDS sont affichés parce qu'ils sont un argument, pas une petite
// ligne : à 1,50 %, une facture de 50 M GNF coûterait 750 000 de commission ;
// le plafond la ramène à 75 000.
//
// AUCUN BOUTON « ACTIVER CE FORFAIT » NON PLUS. POST /organizations/:id/
// commercial-tier existe et est ouvert à owner/admin, mais il écrit le champ
// SANS AUCUNE VÉRIFICATION DE PAIEMENT (voir upgradeCommercialTier : un
// findFirstOrThrow puis un update, rien d'autre). L'exposer donnerait à tout
// dirigeant le moyen de passer en `enterprise` gratuitement, d'un clic. Tant
// qu'aucun encaissement ne garde cette route, l'écran informe et n'engage rien.
//
// Les limites ci-dessous ne sont pas décoratives : elles sont APPLIQUÉES par
// branches.service (succursales), inviteMember (membres et rôles) et
// customers.service (gestion client avancée). lib/plans.spec.ts confronte ce
// miroir au grid backend à chaque exécution des tests.

export default async function AbonnementPage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  let detail;
  try {
    detail = await getOrganization(token, organization.id);
  } catch (error) {
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <EmptyState
          title="Accès réservé"
          description="Seuls les propriétaires et administrateurs peuvent consulter l'abonnement de l'organisation."
        />
      );
    }
    throw error;
  }

  const actuel = detail.commercialTier;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Abonnement</h1>
        <p className="mt-1 max-w-prose text-sm text-navy-600">
          Votre palier est <strong className="text-navy-950">{tierLabel(actuel)}</strong>. Les
          limites et les taux ci-dessous sont ceux réellement appliqués par la plateforme.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TIER_ORDER.map((tier) => (
          <CartePalier key={tier} tier={tier} actuel={actuel} />
        ))}
      </div>

      <Card>
        <div className="flex flex-col gap-2 p-5">
          <h2 className="font-display text-base font-semibold text-navy-950">Comment lire ces taux</h2>
          <p className="max-w-prose text-sm text-navy-600">
            La commission ne s&apos;applique qu&apos;aux encaissements par lien de paiement —
            jamais aux règlements en espèces ni aux virements bancaires. Le total supporté par
            le payeur ajoute les frais de la passerelle Mobile Money, qui ne reviennent pas à
            facture.gn.
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-2 p-5">
          <h2 className="font-display text-base font-semibold text-navy-950">Changer de palier</h2>
          <p className="max-w-prose text-sm text-navy-600">
            Le changement de palier ne se fait pas encore depuis cette page : aucun moyen de
            paiement n&apos;y est rattaché. Contactez facture.gn pour faire évoluer votre formule.
          </p>
        </div>
      </Card>
    </div>
  );
}

function CartePalier({ tier, actuel }: { tier: Tier; actuel: string }) {
  const estActuel = tier === actuel;
  // Un palier sous le sien n'est pas une offre : c'est de l'historique. On le
  // montre quand même, en retrait — comprendre d'où l'on vient aide à situer
  // ce qu'on a gagné.
  const enDessous = tierIndex(tier) < tierIndex(actuel);

  return (
    <Card className={estActuel ? "border-or" : undefined}>
      <div className={`flex h-full flex-col gap-3 p-5 ${enDessous ? "opacity-70" : ""}`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-navy-950">{tierLabel(tier)}</h2>
          {estActuel ? <Badge tone="good">● Votre palier</Badge> : null}
        </div>

        <div className="flex flex-col gap-1 border-y border-navy-50 py-3">
          <p className="font-mono text-xl font-bold tabular-nums text-navy-950">
            {formatGnf(PRIX_MENSUEL_CENTIMES[tier])}
            <span className="text-xs font-normal text-navy-600"> / mois</span>
          </p>
          <dl className="mt-1 flex flex-col gap-0.5 text-xs text-navy-600">
            <div className="flex justify-between gap-2">
              <dt>Commission sur encaissement</dt>
              <dd className="font-mono tabular-nums text-navy-950">{pourcentage(COMMISSION_BPS[tier])}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Plafonnée à</dt>
              <dd className="font-mono tabular-nums text-navy-950">
                {formatGnf(COMMISSION_CAP_CENTIMES[tier])}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt>Total supporté par le payeur</dt>
              <dd className="font-mono tabular-nums text-navy-950">{pourcentage(totalPayeurBps(tier))}</dd>
            </div>
          </dl>
        </div>

        <ul className="flex flex-col gap-1.5">
          {avantagesDuPalier(tier).map((avantage) => (
            <li key={avantage} className="flex gap-2 text-sm text-navy-600">
              <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-or" />
              <span>{avantage}</span>
            </li>
          ))}
        </ul>

        {tier === "custom" ? (
          <p className="mt-auto pt-2 text-xs text-navy-600">
            Formule négociée au cas par cas.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
