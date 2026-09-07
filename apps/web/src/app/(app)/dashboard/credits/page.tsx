import type { Metadata } from "next";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { formatDate, formatGnf } from "@/lib/format";
import { requireSessionToken } from "@/lib/session";
import { getCreditWallet, TrustApiError, type CreditTransactionItem } from "@/lib/trust-api";
import { Badge, Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Crédits — facture.gn" };

// Portefeuille de crédits : le solde, ce qu'il permet, et le relevé complet.
//
// 1 CRÉDIT = 1 GNF. Pas de jeton maison : un taux de change interne aurait
// obligé chaque écran à convertir, et chaque commerçant à faire confiance à la
// conversion. Le pack commercial — 100 SMS pour 30 000 GNF — reste une façon de
// vendre, jamais une unité de compte.
//
// Aucun bouton d'achat : le rechargement passe par la console d'administration
// (POST /internal/credits/grant, clé dédiée). C'est facture.gn qui crédite après
// un encaissement fait ailleurs — pas le commerçant qui décide de son solde.

// Miroir de credits.constants.ts. Sert uniquement à traduire un solde en
// nombre d'envois restants : la facturation, elle, vit côté serveur.
const TARIF_SMS_CENTIMES = 30_000;

const LIBELLES: Record<string, { texte: string; ton: "good" | "navy" | "amber" }> = {
  purchase: { texte: "Rechargement", ton: "good" },
  consumption: { texte: "Consommation", ton: "navy" },
  refund: { texte: "Remboursement", ton: "good" },
  adjustment: { texte: "Ajustement", ton: "amber" },
};

export default async function CreditsPage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  let wallet;
  try {
    wallet = await getCreditWallet(token, organization.id);
  } catch (error) {
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <EmptyState
          title="Accès réservé"
          description="Seuls les propriétaires et administrateurs peuvent consulter le portefeuille de crédits."
        />
      );
    }
    throw error;
  }

  const solde = BigInt(wallet.balanceCentimes);
  const smsRestants = Number(solde / BigInt(TARIF_SMS_CENTIMES));
  const vide = solde === BigInt(0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Crédits</h1>
        <p className="mt-1 max-w-prose text-sm text-navy-600">
          Vos crédits financent les relances envoyées à vos clients par SMS et WhatsApp.
        </p>
      </div>

      <Card className={vide ? "border-amber" : undefined}>
        <div className="p-6">
          <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">Solde</p>
          <p className="mt-1 font-mono text-3xl font-bold tabular-nums text-navy-950">
            {formatGnf(wallet.balanceCentimes)}
          </p>
          <p className="mt-2 text-sm text-navy-600">
            {vide ? (
              <span className="text-amber-text">
                Portefeuille vide — vos relances ne partiront pas tant qu&apos;il n&apos;est pas
                rechargé.
              </span>
            ) : (
              `Environ ${smsRestants} relance${smsRestants > 1 ? "s" : ""} par SMS.`
            )}
          </p>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-2 p-5">
          <h2 className="font-display text-base font-semibold text-navy-950">Recharger</h2>
          <p className="max-w-prose text-sm text-navy-600">
            Le pack de 100 SMS coûte 30 000 GNF. Le rechargement se fait auprès de facture.gn :
            contactez-nous, le crédit est porté sur votre compte dès l&apos;encaissement.
          </p>
          <p className="max-w-prose text-xs text-navy-600">
            La télétransmission de vos déclarations à la DGI n&apos;est jamais facturée en crédits —
            déclarer sa TVA est une obligation légale, pas un service optionnel.
          </p>
        </div>
      </Card>

      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-navy-950">Relevé</h2>
        <p className="mb-3 text-sm text-navy-600">
          Chaque mouvement, du plus récent au plus ancien. Ces lignes ne sont jamais modifiées.
        </p>
        <Card>
          {wallet.transactions.length === 0 ? (
            <p className="p-8 text-center text-sm text-navy-600">Aucun mouvement pour l&apos;instant.</p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {wallet.transactions.map((mouvement) => (
                <Ligne key={mouvement.id} mouvement={mouvement} />
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

function Ligne({ mouvement }: { mouvement: CreditTransactionItem }) {
  const montant = BigInt(mouvement.amountCentimes);
  const credit = montant > BigInt(0);
  const libelle = LIBELLES[mouvement.type] ?? { texte: mouvement.type, ton: "navy" as const };

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm text-navy-950">{mouvement.label}</span>
        <span className="flex items-center gap-2">
          <Badge tone={libelle.ton}>{libelle.texte}</Badge>
          <span className="text-xs text-navy-600">{formatDate(mouvement.createdAt)}</span>
        </span>
      </div>
      <div className="text-right">
        {/* Le signe est porté par la couleur ET par le préfixe : la couleur seule
            ne signale jamais une information (WCAG 1.4.1). */}
        <p
          className={`font-mono text-sm font-bold tabular-nums ${credit ? "text-good-text" : "text-navy-950"}`}
        >
          {credit ? "+" : "−"}
          {formatGnf((montant < BigInt(0) ? -montant : montant).toString())}
        </p>
        <p className="mt-0.5 font-mono text-xs tabular-nums text-navy-600">
          solde {formatGnf(mouvement.balanceAfterCentimes)}
        </p>
      </div>
    </li>
  );
}
