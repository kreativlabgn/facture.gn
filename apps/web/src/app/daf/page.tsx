import type { Metadata } from "next";
import { Badge, Card, CardBody, EmptyState } from "@/components/ui";
import { DisputeStatusPill, StatusPill } from "@/components/StatusPill";
import { formatDate, formatGnf } from "@/lib/format";
import {
  liquidationStage,
  LIQUIDATION_STAGE_LABELS,
  referenceDepense,
} from "@/lib/daf";
import { requireSessionToken } from "@/lib/session";
import { listReceivedInvoices, TrustApiError, type PublicBuyerInvoice } from "@/lib/trust-api";
import { ArbitrageRails } from "./components/ArbitrageRails";
import DafVerificationZone from "@/components/b2g/DafVerificationZone";

export const metadata: Metadata = { title: "Acheteur public — facture.gn" };

// ─────────────────────────────────────────────────────────────────────────────
// CONSOLE DE VALIDATION — J1/J2, ADR-080/088/098.
//
// Écran d'une administration cliente qui suit les factures de ses fournisseurs
// et reconnaît le service fait. Ce que la console enregistre est un acte de
// l'administration elle-même : facture.gn n'y valide aucune dépense et n'y
// appose aucun visa propre — elle recueille celui que le service dépense pose,
// et le rend vérifiable.
//
// UNE SEULE PAGE, aucun écran de détail : GET /public-buyer/invoices est la
// seule lecture dont dispose ce persona (aucune route /public-buyer/invoices/:id
// n'existe). Un détail par facture obligerait à re-filtrer côté web une ligne
// déjà chargée — plus de code pour aucune donnée de plus.
//
// PAGINATION : take/skip existent côté service (défaut 50, plafond 100) mais ne
// sont pas exposés tant qu'aucun compte réel n'approche le plafond. L'encours
// total, lui, porte sur le périmètre ENTIER — il reste juste quelle que soit la
// page affichée, et ne doit jamais être recalculé à partir des lignes visibles.
//
// CE QUI MANQUE, ET POURQUOI : le NOM du fournisseur émetteur. Le service ne
// renvoie aucune relation `organization`, et ce persona n'a aucune route pour
// résoudre un organizationId. Les lignes sont donc identifiées par la référence
// du circuit de la dépense (engagement, bon de commande, marché) — jamais par
// un nom deviné.
// ─────────────────────────────────────────────────────────────────────────────

// Le chiffre que le DAF regarde en premier : ce que son administration doit,
// tous fournisseurs confondus. Mono — c'est un montant certifié, jamais une
// saisie (charte §Typographie).
function EncoursTotal({ total, nombre }: { total: string; nombre: number }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-semibold text-navy-600">Encours fournisseurs</p>
        <p className="mt-2 font-mono text-2xl font-bold text-navy-950">{formatGnf(total)}</p>
        <p className="mt-2 text-xs text-navy-600">
          {nombre === 0
            ? "Aucune facture en circulation."
            : `Sur ${nombre} facture${nombre > 1 ? "s" : ""} reçue${nombre > 1 ? "s" : ""}, hors brouillons et annulations.`}
        </p>
      </CardBody>
    </Card>
  );
}

function LigneFacture({ invoice }: { invoice: PublicBuyerInvoice }) {
  const reference = referenceDepense(invoice);
  const stage = LIQUIDATION_STAGE_LABELS[liquidationStage(invoice)];

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-navy-600">{reference.label}</p>
            {/* Donnée figée du document, jamais une saisie en cours — mono. */}
            <p className="mt-1 font-mono text-sm font-bold text-navy-950">{reference.value}</p>
            {invoice.certificationId ? (
              <p className="mt-1 font-mono text-xs font-bold text-navy-600">#{invoice.certificationId}</p>
            ) : null}
          </div>
          {/* Trois signaux volontairement distincts : où en est le VISA, où en
              est le PAIEMENT, et si un litige court. Les fondre en une seule
              pastille ferait lire « payé » là où l'administration n'a encore
              rien reconnu (ADR-080 : liquidation ≠ ordonnancement ≠ paiement). */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stage.tone}>
              {stage.glyph} {stage.label}
            </Badge>
            <StatusPill status={invoice.status} />
            <DisputeStatusPill disputeStatus={invoice.disputeStatus} />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold text-navy-600">Montant certifié</p>
            <p className="mt-1 font-mono text-sm font-bold text-navy-950">{formatGnf(invoice.totalTtc)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-navy-600">Reste à régler</p>
            <p className="mt-1 font-mono text-sm font-bold text-navy-950">{formatGnf(invoice.amountDue)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-navy-600">Émise le</p>
            <p className="mt-1 font-mono text-sm font-bold text-navy-950">
              {invoice.issuedAt ? formatDate(invoice.issuedAt) : "—"}
            </p>
          </div>
        </div>

        <ArbitrageRails invoice={invoice} />

        <DafVerificationZone
          invoice={{
            id: invoice.id,
            number: invoice.number,
            referenceMarche: invoice.referenceMarche,
            validatedByAdministration: invoice.validatedByAdministration,
            disputeStatus: invoice.disputeStatus,
          }}
        />
      </CardBody>
    </Card>
  );
}

export default async function DafConsolePage() {
  const token = await requireSessionToken();

  let data;
  try {
    data = await listReceivedInvoices(token);
  } catch (error) {
    // 403 = ce compte n'est rattaché à aucun compte acheteur public — le cas
    // d'un utilisateur PME qui atterrit ici, pas une panne. On l'explique
    // plutôt que de laisser remonter l'écran d'erreur générique.
    if (error instanceof TrustApiError && error.status === 403) {
      return (
        <EmptyState
          title="Aucun espace acheteur public"
          description="Votre compte n'est rattaché à aucune administration cliente. Le rattachement est posé à la création de l'espace, par la personne qui en a la charge."
        />
      );
    }
    throw error;
  }

  const { invoices, outstandingTotal } = data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-navy-950">Console de validation</h1>
        <p className="mt-2 max-w-2xl text-sm text-navy-600">
          Factures certifiées adressées à votre administration. Viser le service fait reconnaît la
          dette ; le rail de règlement indique à qui le paiement revient.
        </p>
      </div>

      <EncoursTotal total={outstandingTotal} nombre={invoices.length} />

      {invoices.length === 0 ? (
        <EmptyState
          title="Aucune facture reçue"
          description="Les factures apparaissent ici dès qu'un fournisseur vous en adresse une et que le rattachement de son compte client à votre administration a été confirmé."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {invoices.map((invoice) => (
            <LigneFacture key={invoice.id} invoice={invoice} />
          ))}
        </div>
      )}
    </div>
  );
}
