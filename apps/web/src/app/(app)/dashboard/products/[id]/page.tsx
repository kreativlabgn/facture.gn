import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSessionToken } from "@/lib/session";
import { getProduct, TrustApiError } from "@/lib/trust-api";
import { DuplicateWarningPill } from "@/components/StatusPill";
import { ProductActiveStatusBadge } from "../ProductBadges";
import { EditProductForm } from "./EditProductForm";

type Params = { id: string };

export const metadata: Metadata = { title: "Produit — facture.gn" };

// Catalogue produits/services (docs/plans/2026-09-16-catalogue-produits-services.md)
// — écran détail devenu écran d'édition (name/description/salePrice/isActive,
// voir EditProductForm), même structure que customers/[id]/page.tsx pour la
// gestion 404/403 via TrustApiError. Sans MergeDuplicateForm :
// ProductsService.merge() n'existe pas (E3, décision actée — la fusion n'est
// demandée par le Backlog que pour les clients, E4), le signal de doublon
// reste affiché en lecture seule avec un lien texte vers la fiche candidate,
// jamais de bouton d'action.
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
          <ProductActiveStatusBadge isActive={product.isActive} />
          {product.possibleDuplicateOf ? <DuplicateWarningPill /> : null}
        </div>
        <Link href="/dashboard/products" className="text-sm font-medium text-navy-600 hover:text-navy-950">
          ← Retour
        </Link>
      </div>

      <div className="mb-6">
        <EditProductForm product={product} />
      </div>

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
