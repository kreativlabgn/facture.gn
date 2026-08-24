import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionToken } from "@/lib/session";
import { listProducts, listMyOrganizations } from "@/lib/trust-api";
import { formatGnf } from "@/lib/format";
import { DuplicateWarningPill } from "@/components/StatusPill";

export const metadata: Metadata = { title: "Produits — facture.gn" };

// UI backlog gap comblé ici — écran liste produits, même structure que
// customers/page.tsx. Pas de formulaire de création (hors périmètre demandé :
// la création existe déjà côté API — POST /products, E10 — mais aucun écran
// n'est demandé ici).
export default async function ProductsPage() {
  const token = await requireSessionToken();
  const organizations = await listMyOrganizations(token);
  const organization = organizations[0];
  if (!organization) {
    return null;
  }

  const products = await listProducts(token, organization.id, { take: 100 });

  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold text-navy-950">Produits</h1>
      <div className="mb-6 rounded-2xl border border-navy-100 bg-white">
        {products.length === 0 ? (
          <p className="p-8 text-center text-sm text-navy-600">Aucun produit pour le moment.</p>
        ) : (
          products.map((product, index) => (
            <Link
              key={product.id}
              href={`/dashboard/products/${product.id}`}
              className={`flex items-center justify-between gap-4 px-5 py-4 transition hover:bg-navy-50/40 ${index === products.length - 1 ? "" : "border-b border-navy-50"}`}
            >
              <div className="flex items-center gap-3">
                <span className="font-semibold text-navy-950">{product.name}</span>
                {product.possibleDuplicateOf ? <DuplicateWarningPill /> : null}
              </div>
              <span className="font-mono text-xs text-navy-600">
                {product.costPrice ? formatGnf(product.costPrice) : "—"}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
