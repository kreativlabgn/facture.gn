import type { Metadata } from "next";
import { fetchInvoiceVerification } from "@/lib/trust-api";
import { SiteHeader } from "@/components/SiteHeader";
import { TrustSeal } from "@/components/TrustSeal";
import { InvoiceSummary } from "@/components/InvoiceSummary";
import { TrustExplainer } from "@/components/TrustExplainer";

type Params = { certificationId: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { certificationId } = await params;
  return { title: `Vérification ${certificationId} — facture.gn` };
}

export default async function VerificationPage({ params }: { params: Promise<Params> }) {
  const { certificationId } = await params;
  const invoice = await fetchInvoiceVerification(certificationId);

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6">
        {invoice ? (
          <>
            <TrustSeal valid={invoice.integrityValid} />
            <InvoiceSummary invoice={invoice} />
            <TrustExplainer />
          </>
        ) : (
          <NotFound certificationId={certificationId} />
        )}
      </main>
    </div>
  );
}

// Distinct d'un échec d'intégrité (TrustSeal, valid=false) : un identifiant
// inconnu n'est PAS une preuve d'altération, seulement une absence de
// correspondance (faute de frappe, lien erroné) — jamais le même ton alarmant.
function NotFound({ certificationId }: { certificationId: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-ink-100 bg-white px-8 py-10 text-center">
      <p className="text-lg font-semibold text-ink-950">Aucune facture ne correspond à cet identifiant</p>
      <p className="max-w-md text-sm text-ink-500">
        Vérifiez que l&apos;identifiant <span className="font-mono text-ink-700">{certificationId}</span> a été
        copié intégralement, sans espace ni caractère manquant.
      </p>
    </div>
  );
}
