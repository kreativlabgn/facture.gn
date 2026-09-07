import type { Metadata } from "next";
import { resolveActiveOrganization } from "@/lib/active-organization";
import {
  TIER_ORDER,
  avantagesDuPalier,
  tierIndex,
  tierLabel,
  type Tier,
} from "@/lib/plans";
import { requireSessionToken } from "@/lib/session";
import { Badge, Card, EmptyState } from "@/components/ui";
import { getOrganization, TrustApiError } from "@/lib/trust-api";

export const metadata: Metadata = { title: "Abonnement — facture.gn" };

// Ce que chaque palier ouvre, et où se situe l'organisation.
//
// AUCUN PRIX N'EST AFFICHÉ, et c'est une décision, pas un oubli : il n'en existe
// aucun dans le dépôt. Ni au schéma, ni dans les grilles hardcodées, ni dans
// docs/. Le document « Grille-Offres-facture-gn.md » est cité en commentaire
// mais absent. Un montant inventé sur un écran d'abonnement serait le pire
// endroit possible pour en inventer un.
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
          Votre palier est <strong className="text-navy-950">{tierLabel(actuel)}</strong>. Voici ce
          que chaque palier ouvre — ce sont les limites réellement appliquées, pas une plaquette.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TIER_ORDER.map((tier) => (
          <CartePalier key={tier} tier={tier} actuel={actuel} />
        ))}
      </div>

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
