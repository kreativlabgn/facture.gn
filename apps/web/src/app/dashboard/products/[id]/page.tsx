import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSessionToken } from "@/lib/session";
import { getProduct, TrustApiError } from "@/lib/trust-api";
import { formatGnf } from "@/lib/format";
import { DuplicateWarningPill } from "@/components/StatusPill";

type Params = { id: string };

export const metadata: Metadata = { title: "Produit — facture.gn" };

// UI backlog gap comblé ici — écran détail produit, même structure que
// customers/[id]/page.tsx (gestion 404/403 via TrustApiError). Sans
// MergeDuplicateForm : ProductsService.merge() n'existe pas (E3, décision
// actée — la fusion n'est demandée par le Backlog que pour les clients, E4),
// le signal de doublon est affiché en lecture seule avec un lien texte vers
// la fiche candidate, jamais de bouton d'action.
export default async function ProductDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const token = await requireSessionToken();

  let product;
  try {
    product = await getProduct(token, id);
  } catch (error) {
    if (error instanceof TrustApiError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-navy-950">{product.name}</h1>
          {product.possibleDuplicateOf ? <DuplicateWarningPill /> : null}
        </div>
        <Link href="/dashboard/products" className="text-sm font-medium text-navy-600 hover:text-navy-950">
          ← Retour
        </Link>
      </div>

      <dl className="mb-6 space-y-3 rounded-2xl border border-navy-100 bg-white p-5">
        <Row label="Coût" value={product.costPrice ? formatGnf(product.costPrice) : "—"} />
      </dl>

      {product.possibleDuplicateOf && product.duplicateOf ? (
        <div className="rounded-2xl border border-amber-text/30 bg-amber-bg/40 p-5">
          <p className="text-sm text-navy-950">
            Doublon possible avec{" "}
            <Link
              href={`/dashboard/products/${product.duplicateOf.id}`}
              className="font-semibold underline hover:text-navy-600"
            >
              {product.duplicateOf.name}
            </Link>
            . Signal informatif uniquement — aucune fusion automatique n&apos;est proposée pour le catalogue produit.
          </p>
        </div>
      ) : null}
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
