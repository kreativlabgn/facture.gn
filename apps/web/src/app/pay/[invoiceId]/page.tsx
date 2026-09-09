import type { Metadata } from "next";
import { fetchPublicCheckout } from "@/lib/money-api";
import { formatGnf } from "@/lib/format";
import { Wordmark } from "@/components/Wordmark";

type Params = { invoiceId: string };

export const metadata: Metadata = { title: "Payer — facture.gn" };

// Première page de ce repo destinée à un payeur sans compte facture.gn (C19) —
// affiche montant + frais gateway AVANT de rediriger vers le provider
// (Djomy/Moneroo), pour ne jamais laisser le payeur découvrir les frais une
// fois déjà chez le provider.
export default async function CheckoutPage({ params }: { params: Promise<Params> }) {
  const { invoiceId } = await params;
  const checkout = await fetchPublicCheckout(invoiceId);

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-navy-100 bg-white">
        <div className="mx-auto flex max-w-[420px] items-center px-4 py-4 sm:px-6">
          <Wordmark href="/" ariaLabel="facture.gn — Accueil" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[420px] flex-1 px-4 py-12 sm:px-6">
        {checkout ? <CheckoutSummary checkout={checkout} /> : <NoActiveLink />}
      </main>
    </div>
  );
}

function CheckoutSummary({ checkout }: { checkout: NonNullable<Awaited<ReturnType<typeof fetchPublicCheckout>>> }) {
  const amount = BigInt(checkout.amountGnf);
  const feeGateway = BigInt(checkout.feeGatewayGnf);
  const feePlatform = BigInt(checkout.feePlatformGnf);
  const total = amount + feeGateway;
  // `amountGnf` porte DÉJÀ la commission facture.gn : la marchandise, c'est ce
  // qui reste quand on la retire. L'ancienne ligne « Montant de la facture »
  // affichait la somme des deux sous le nom de la première — le payeur voyait
  // un prix et en réglait un autre.
  const marchandise = amount - feePlatform;
  const expired = checkout.expiresAt !== null && new Date(checkout.expiresAt) < new Date();

  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-6">
      <p className="mb-6 font-display text-lg font-bold text-navy-950">Paiement</p>
      {/* Les trois montants sont RELUS de la tentative de paiement, jamais
          recalculés depuis le barème : ce qui est affiché est ce qui a été
          facturé, pas ce que la grille prévoit aujourd'hui. Un barème qui
          changerait entre la création du lien et son règlement ne doit pas
          réécrire après coup ce que le payeur voit. */}
      <dl className="space-y-3">
        <Row label="Montant de la marchandise" value={formatGnf(marchandise.toString())} />
        <Row label="Frais d'infrastructure facture.gn" value={formatGnf(checkout.feePlatformGnf)} />
        <Row label="Frais réseau Djomy" value={formatGnf(checkout.feeGatewayGnf)} />
        <div className="border-t border-navy-100 pt-3">
          <Row label="Total à payer" value={formatGnf(total.toString())} bold />
        </div>
      </dl>

      {expired || !checkout.paymentLinkUrl ? (
        <p className="mt-6 text-center text-sm text-navy-600">Ce lien de paiement a expiré.</p>
      ) : (
        <a
          href={checkout.paymentLinkUrl}
          className="mt-6 block rounded-[10px] bg-or px-6 py-3 text-center font-display text-sm font-semibold text-navy-950 transition hover:brightness-95"
        >
          Payer {formatGnf(total.toString())} via {checkout.provider === "djomy" ? "Djomy" : "Moneroo"}
        </a>
      )}
    </div>
  );
}

function Row({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-sm text-navy-600">{label}</dt>
      <dd className={`font-mono text-sm ${bold ? "font-bold text-navy-950" : "text-navy-950"}`}>{value}</dd>
    </div>
  );
}

function NoActiveLink() {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
      <p className="font-display text-lg font-bold text-navy-950">Aucun lien de paiement actif</p>
      <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
        Ce lien n&apos;est plus valide. Contactez le marchand pour obtenir un nouveau lien de paiement.
      </p>
    </div>
  );
}
