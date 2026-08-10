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
      <main className="mx-auto w-full max-w-[520px] flex-1 px-4 py-12 sm:px-6">
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
// correspondance (faute de frappe, lien erroné) — jamais le même ton
// alarmant, donc jamais la couleur rouge sémantique de la charte (R-12,
// réservée aux échecs réels).
function NotFound({ certificationId }: { certificationId: string }) {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-8 text-center">
      <p className="font-display text-lg font-bold text-navy-950">Aucune facture ne correspond à cet identifiant</p>
      <p className="mx-auto mt-3 max-w-sm text-sm text-navy-600">
        Vérifiez que l&apos;identifiant <span className="font-mono text-navy-950">{certificationId}</span> a été
        copié intégralement, sans espace ni caractère manquant.
      </p>
    </div>
  );
}
