import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { doitInterrogerLesRails, etatArbitrage } from "@/lib/financing";
import { formatDate, formatGnf } from "@/lib/format";
import { invoiceEventLabel, type EventTone } from "@/lib/invoice-events";
import { hasPermission } from "@/lib/permissions";
import { requireSessionToken } from "@/lib/session";
import {
  getFinancingOptions,
  getInvoice,
  TrustApiError,
  type FinancingOptions,
  type InvoiceFullDetail,
} from "@/lib/trust-api";
import { DisputeStatusPill, StatusPill } from "@/components/StatusPill";
import { Card } from "@/components/ui";
import { ArbitrageMarchandForm } from "./ArbitrageMarchandForm";
import {
  IssueInvoiceForm,
  RegenerateLinkForm,
  SendReminderForm,
  VoidInvoiceForm,
} from "./InvoiceActions";

export const metadata: Metadata = { title: "Facture — facture.gn" };

// Écran de détail d'une facture. Jusqu'ici la coquille listait les factures
// sans jamais permettre d'en ouvrir une : onze routes de trust-api étaient
// servies sans aucune interface.
//
// C'est le seul endroit où la PME voit la PREUVE de certification — identifiant
// public, empreinte, chaînage vers la facture précédente — et le journal
// d'événements append-only (ADR-015) qui rend le document opposable. Le reste
// de l'écran (lignes, encaissement, lien de paiement) tourne autour de ça.
//
// Aucune vérification manuelle d'organisation : GET /invoices/:id est déjà
// scopé par @OrganizationIdSource + RolesGuard côté trust-api, qui rend un 404
// opaque aussi bien pour une facture inexistante que pour celle d'un tiers
// (correctif d'opacification du 7 septembre). On relaie ce 404 tel quel.

type Params = { id: string };

export default async function InvoiceDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const token = await requireSessionToken();

  let invoice: InvoiceFullDetail;
  try {
    invoice = await getInvoice(token, id);
  } catch (error) {
    if (error instanceof TrustApiError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  // Le rôle sert à ne pas proposer une action que trust-api refusera. Ce n'est
  // pas la barrière — RolesGuard l'est — mais un bouton qui ne peut mener qu'à
  // un 403 n'a rien à faire à l'écran.
  const { active: organization } = await resolveActiveOrganization(token);
  const role = organization?.role ?? "";

  const brouillon = invoice.status === "draft";
  const emise = invoice.issuedAt !== null;
  const soldee = invoice.status === "paid" || invoice.status === "voided";

  const peutEmettre = brouillon && hasPermission(role, "invoices:issue");
  const peutAnnuler =
    (invoice.status === "draft" || invoice.status === "issued") && hasPermission(role, "invoices:void");
  const peutRelancer = emise && !soldee && hasPermission(role, "invoices:relance");

  // ── Rails de financement B2G (ADR-088/089, K4/K5) ────────────────────────
  // Le verdict d'éligibilité vient de trust-api, jamais d'une règle recopiée
  // ici : deux des cinq conditions d'is_financeable() — compte acheteur public
  // « verified », rattachement client confirmé — ne figurent dans AUCUN champ
  // d'InvoiceFullDetail. L'appel n'est émis que quand il peut servir
  // (doitInterrogerLesRails) : la route est @Roles("owner","admin"), et un
  // écran de détail n'a pas à payer un aller-retour pour une section qu'il ne
  // rendra pas.
  let rails: FinancingOptions | null = null;
  let railsIndisponibles = false;
  if (doitInterrogerLesRails(role, invoice)) {
    try {
      rails = await getFinancingOptions(token, invoice.id);
    } catch {
      // Une section optionnelle qui ne charge pas ne doit pas emporter l'écran :
      // les lignes, la preuve de certification et le journal restent la raison
      // d'être de cette page. L'échec n'est pas pour autant avalé — il est
      // ANNONCÉ plus bas, sinon un commerçant éligible verrait simplement
      // l'arbitrage disparaître sans jamais savoir pourquoi.
      railsIndisponibles = true;
    }
  }

  const arbitrage = etatArbitrage({ role, invoice, financeable: rails?.financeable ?? null });

  return (
    <div className="flex flex-col gap-6">
      {/* ── En-tête ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-navy-950">
              {invoice.number ?? "Brouillon"}
            </h1>
            <StatusPill status={invoice.status} />
            <DisputeStatusPill disputeStatus={invoice.disputeStatus} />
          </div>
          <p className="text-sm text-navy-600">
            {invoice.customer ? invoice.customer.name : "Client non renseigné"}
            {invoice.customer?.nif ? ` · NIF ${invoice.customer.nif}` : ""}
          </p>
        </div>
        <Link
          href="/dashboard/invoices"
          className="text-sm font-medium text-navy-600 hover:text-navy-950"
        >
          ← Retour
        </Link>
      </div>

      {/* ── Litige ─────────────────────────────────────────────────────── */}
      {/* Un litige ouvert est la première chose à savoir : il passe avant le
          montant, avant les lignes, avant tout le reste. */}
      {invoice.disputeStatus === "disputed" ? (
        <div className="rounded-2xl border border-bad bg-bad-bg p-5">
          <p className="font-display font-semibold text-bad-text">Litige ouvert sur cette facture</p>
          <p className="mt-1 text-sm text-navy-700">
            Le client conteste ce document. Le règlement du litige se fait hors plateforme ; la
            facture reste émise et conserve son numéro tant qu&apos;elle n&apos;est pas annulée ou
            avoirée.
          </p>
        </div>
      ) : null}

      {/* ── Montants ───────────────────────────────────────────────────── */}
      <Card>
        <div className="grid grid-cols-1 divide-y divide-navy-50 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <Montant libelle="Total TTC" valeur={invoice.totalTtc} fort />
          <Montant libelle="Déjà encaissé" valeur={invoice.amountPaid} />
          <Montant libelle="Reste à payer" valeur={invoice.amountDue} fort />
        </div>
        <dl className="grid gap-2 border-t border-navy-50 px-5 py-4 sm:grid-cols-2">
          <Ligne libelle="Total HT" valeur={formatGnf(invoice.totalHt)} />
          <Ligne libelle="TVA" valeur={formatGnf(invoice.totalTva)} />
          <Ligne
            libelle="Émise le"
            valeur={invoice.issuedAt ? formatDate(invoice.issuedAt) : "Pas encore émise"}
          />
          <Ligne libelle="Créée le" valeur={formatDate(invoice.createdAt)} />
          {invoice.referenceMarche ? (
            <Ligne libelle="Référence marché" valeur={invoice.referenceMarche} mono />
          ) : null}
          {invoice.validatedByAdministration ? (
            <Ligne libelle="Administration" valeur="Liquidation validée" />
          ) : null}
        </dl>
      </Card>

      {/* ── Financement de la créance ──────────────────────────────────── */}
      {/* Placé juste après les montants : ce que la PME touchera, et quand,
          est la suite immédiate de combien elle a facturé. La section
          n'apparaît QUE pour owner/admin sur une facture B2G visée et vivante
          — ou, définitivement, sur une créance déjà cédée (K5). */}
      {arbitrage !== "masque" ? (
        <section>
          <h2 className="mb-1 font-display text-lg font-semibold text-navy-950">
            Financement de la créance
          </h2>
          <p className="mb-3 text-sm text-navy-600">
            {arbitrage === "cedee"
              ? "La créance a été rachetée par un établissement financier. L'opération est définitive et inscrite au journal de la facture."
              : "L'administration a visé le service fait : vous pouvez être payé maintenant par un établissement financier agréé, ou attendre le règlement du Trésor public."}
          </p>
          <ArbitrageMarchandForm
            invoiceId={invoice.id}
            totalTtc={invoice.totalTtc}
            etat={arbitrage}
            partenaires={rails?.partners ?? []}
            cessionnaire={rails?.financedByPartner ?? null}
            financedByPartnerId={invoice.financedByPartnerId}
            financedAt={invoice.financedAt}
          />
        </section>
      ) : null}

      {/* L'échec de chargement des rails est ANNONCÉ, jamais seulement subi :
          sans cette ligne, un commerçant éligible verrait l'arbitrage
          disparaître sans distinguer « pas finançable » de « pas su lire ». */}
      {railsIndisponibles && arbitrage === "masque" ? (
        <div role="status" className="rounded-2xl border border-amber bg-amber-bg p-5">
          <p className="font-display text-sm font-bold text-navy-950">
            Options de financement momentanément illisibles
          </p>
          <p className="mt-1 text-sm text-navy-700">
            Impossible de savoir si cette facture est finançable pour l&apos;instant. Réessayez dans
            un moment — le reste de la facture, lui, est à jour.
          </p>
        </div>
      ) : null}

      {/* ── Lignes ─────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold text-navy-950">Détail des lignes</h2>
        <Card>
          {invoice.lines.length === 0 ? (
            <p className="p-8 text-center text-sm text-navy-600">Cette facture ne porte aucune ligne.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-navy-50 text-left">
                    <th className="px-5 py-3 text-xs font-semibold tracking-wide text-navy-600 uppercase">
                      Désignation
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold tracking-wide text-navy-600 uppercase">
                      Qté
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold tracking-wide text-navy-600 uppercase">
                      P.U.
                    </th>
                    <th className="px-5 py-3 text-right text-xs font-semibold tracking-wide text-navy-600 uppercase">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-50">
                  {invoice.lines.map((ligne) => (
                    <tr key={ligne.id}>
                      <td className="px-5 py-3 text-navy-950">
                        {ligne.description}
                        {ligne.productCode ? (
                          <span className="ml-2 font-mono text-xs text-navy-600">{ligne.productCode}</span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums text-navy-950">
                        {ligne.quantity}
                      </td>
                      <td className="px-5 py-3 text-right font-mono tabular-nums text-navy-950">
                        {formatGnf(ligne.unitPrice)}
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-bold tabular-nums text-navy-950">
                        {formatGnf((BigInt(ligne.unitPrice) * BigInt(ligne.quantity)).toString())}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      {/* ── Preuve de certification ────────────────────────────────────── */}
      {/* Le cœur du produit. Un brouillon n'a rien à prouver : la section
          n'apparaît qu'une fois la facture émise. */}
      {invoice.certificationId || invoice.hash ? (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-navy-950">
            Preuve de certification
          </h2>
          <Card>
            <dl className="grid gap-3 p-5">
              {invoice.certificationId ? (
                <Ligne libelle="Identifiant de vérification" valeur={invoice.certificationId} mono />
              ) : null}
              {invoice.hash ? <Empreinte libelle="Empreinte de la facture" valeur={invoice.hash} /> : null}
              {invoice.previousHash ? (
                <Empreinte
                  libelle="Empreinte de la facture précédente"
                  valeur={invoice.previousHash}
                  aide="Chaque facture scelle la précédente : retirer ou modifier une pièce rompt la chaîne."
                />
              ) : null}
            </dl>
            {invoice.certificationId ? (
              <div className="border-t border-navy-50 px-5 py-4">
                <Link
                  href={`/${encodeURIComponent(invoice.certificationId)}`}
                  className="text-sm font-medium text-navy-950 underline underline-offset-2"
                >
                  Voir la page de vérification publique
                </Link>
                <p className="mt-1 text-xs text-navy-600">
                  C&apos;est ce que voit votre client, sans compte ni connexion.
                </p>
              </div>
            ) : null}
          </Card>
        </section>
      ) : null}

      {/* ── Lien de paiement ───────────────────────────────────────────── */}
      {invoice.paymentLinkUrl ? (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-navy-950">Lien de paiement</h2>
          <Card>
            <div className="flex flex-col gap-2 p-5">
              <code className="rounded-lg bg-navy-50 px-3 py-2 font-mono text-xs break-all text-navy-950">
                {invoice.paymentLinkUrl}
              </code>
              <p className="text-xs text-navy-600">
                {invoice.paymentLinkExpiresAt
                  ? `Valable jusqu'au ${formatDate(invoice.paymentLinkExpiresAt)}.`
                  : "Sans date d'expiration."}
              </p>
            </div>
          </Card>
        </section>
      ) : null}

      {/* ── Actions ────────────────────────────────────────────────────── */}
      {peutEmettre || peutAnnuler || peutRelancer || emise ? (
        <section>
          <h2 className="mb-3 font-display text-lg font-semibold text-navy-950">Actions</h2>
          <div className="flex flex-col gap-4">
            {peutEmettre ? (
              <Card>
                <div className="p-5">
                  <IssueInvoiceForm invoiceId={invoice.id} />
                </div>
              </Card>
            ) : null}

            {peutRelancer ? (
              <Card>
                <div className="flex flex-col gap-5 p-5 sm:flex-row sm:gap-8">
                  <SendReminderForm invoiceId={invoice.id} />
                  <RegenerateLinkForm invoiceId={invoice.id} existant={invoice.paymentLinkUrl !== null} />
                </div>
              </Card>
            ) : null}

            {emise ? (
              <Card>
                <div className="p-5">
                  <a
                    href={`/dashboard/invoices/${encodeURIComponent(invoice.id)}/pdf`}
                    className="text-sm font-medium text-navy-950 underline underline-offset-2"
                  >
                    Télécharger le PDF
                  </a>
                </div>
              </Card>
            ) : null}

            {peutAnnuler ? (
              <Card>
                <div className="p-5">
                  <VoidInvoiceForm invoiceId={invoice.id} />
                </div>
              </Card>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* ── Journal ────────────────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 font-display text-lg font-semibold text-navy-950">Journal</h2>
        <p className="mb-3 text-sm text-navy-600">
          Tout ce qui est arrivé à cette facture. Ces lignes ne peuvent être ni modifiées ni
          supprimées.
        </p>
        <Card>
          {invoice.events.length === 0 ? (
            <p className="p-8 text-center text-sm text-navy-600">
              Aucun événement enregistré pour l&apos;instant.
            </p>
          ) : (
            <ul className="divide-y divide-navy-50">
              {invoice.events.map((evenement) => {
                const { label, ton } = invoiceEventLabel(evenement.type);
                return (
                  <li key={evenement.id} className="flex gap-3 px-5 py-4">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${MARQUEUR[ton]}`}
                    />
                    <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <div>
                        <p className="text-sm text-navy-950">{label}</p>
                        <p className="text-xs text-navy-600">
                          {formatDate(evenement.createdAt)}
                          {evenement.actor ? ` · ${evenement.actor.name}` : ""}
                        </p>
                      </div>
                      {evenement.amount ? (
                        <span className="font-mono text-sm font-bold text-navy-950">
                          {formatGnf(evenement.amount)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

// Repère de la frise : distingue ce qui appelle une vigilance d'un simple
// constat. `bg-navy-400` est une bordure/marqueur, jamais du texte — le
// garde-fou AA ne vise que text-navy-*.
const MARQUEUR: Record<EventTone, string> = {
  neutre: "bg-navy-400",
  bon: "bg-good",
  attention: "bg-amber",
  alerte: "bg-bad",
};

function Montant({ libelle, valeur, fort = false }: { libelle: string; valeur: string; fort?: boolean }) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-semibold tracking-wide text-navy-600 uppercase">{libelle}</p>
      <p
        className={`mt-1 font-mono tabular-nums text-navy-950 ${fort ? "text-xl font-bold" : "text-lg"}`}
      >
        {formatGnf(valeur)}
      </p>
    </div>
  );
}

function Ligne({ libelle, valeur, mono = false }: { libelle: string; valeur: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm text-navy-600">{libelle}</dt>
      <dd className={`text-sm text-navy-950 ${mono ? "font-mono break-all" : ""}`}>{valeur}</dd>
    </div>
  );
}

// Une empreinte fait 64 caractères hexadécimaux : elle ne tient pas sur la même
// ligne que son libellé sur un téléphone. Bloc dédié, chasse fixe, coupure
// autorisée — c'est une donnée à comparer caractère par caractère.
function Empreinte({ libelle, valeur, aide }: { libelle: string; valeur: string; aide?: string }) {
  return (
    <div>
      <dt className="text-sm text-navy-600">{libelle}</dt>
      <dd className="mt-1 rounded-lg bg-navy-50 px-3 py-2 font-mono text-xs break-all text-navy-950">
        {valeur}
      </dd>
      {aide ? <p className="mt-1 text-xs text-navy-600">{aide}</p> : null}
    </div>
  );
}
