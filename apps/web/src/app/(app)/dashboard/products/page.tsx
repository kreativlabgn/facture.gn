import type { Metadata } from "next";
import Link from "next/link";
import { requireSessionToken } from "@/lib/session";
import { resolveActiveOrganization } from "@/lib/active-organization";
import { hasPermission } from "@/lib/permissions";
import { listProducts, type ProductListItem } from "@/lib/trust-api";
import { formatGnf } from "@/lib/format";
import { DuplicateWarningPill } from "@/components/StatusPill";
import { ButtonLink } from "@/components/ui";
import { DataTable, type Column } from "@/components/data/DataTable";
import { PRODUCT_TYPE_LABELS, ProductActiveStatusBadge } from "./ProductBadges";

export const metadata: Metadata = { title: "Produits — facture.gn" };

// Le lien est porté par la cellule « Produit », pas par la ligne entière : une
// <tr> cliquable n'est ni annoncée comme un lien ni atteignable au clavier, et
// le clic milieu n'y ouvre rien. Un <a> dans la première cellule reste un lien
// ordinaire, avec tout ce que ça implique.
const COLUMNS: readonly Column<ProductListItem>[] = [
  {
    key: "name",
    header: "Produit",
    cell: (product) => (
      <span className="flex flex-wrap items-center gap-2">
        <Link
          href={`/dashboard/products/${product.id}`}
          className="font-semibold text-navy-950 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
        >
          {product.name}
        </Link>
        {product.possibleDuplicateOf ? <DuplicateWarningPill /> : null}
      </span>
    ),
  },
  {
    key: "type",
    header: "Type",
    cell: (product) => <span className="text-navy-600">{PRODUCT_TYPE_LABELS[product.type] ?? product.type}</span>,
  },
  {
    key: "costPrice",
    header: "Coût",
    align: "right",
    // costPrice nullable — E6 : la création d'un produit n'est jamais bloquée
    // par l'absence de coût. Un tiret dit « non renseigné », pas « zéro ».
    cell: (product) => (
      <span className="font-mono text-xs text-navy-600">{product.costPrice ? formatGnf(product.costPrice) : "—"}</span>
    ),
  },
  {
    key: "status",
    header: "Statut",
    // Vide quand actif — c'est l'état normal, il n'a pas besoin de pastille
    // (voir ProductActiveStatusBadge). Seul un article retiré du catalogue
    // affiche un signal.
    cell: (product) => <ProductActiveStatusBadge isActive={product.isActive} />,
  },
];

// UI backlog gap comblé ici — écran liste produits, désormais avec un lien de
// création (docs/plans/2026-09-16-catalogue-produits-services.md). Le bouton
// reste visible sur mobile (contrairement au CTA équivalent de
// dashboard/invoices/page.tsx) : la coquille n'a pas de FAB « + Produit » dans
// la barre basse pour prendre le relais sur petit écran.
export default async function ProductsPage() {
  const token = await requireSessionToken();
  const { active: organization } = await resolveActiveOrganization(token);
  if (!organization) {
    return null;
  }

  const products = await listProducts(token, organization.id, { take: 100 });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-navy-950">Produits</h1>
        {hasPermission(organization.role, "products:read") ? (
          <ButtonLink href="/dashboard/products/new" variant="accent">
            + Nouveau produit
          </ButtonLink>
        ) : null}
      </div>
      <DataTable
        columns={COLUMNS}
        rows={products}
        getRowKey={(product) => product.id}
        emptyMessage="Aucun produit pour le moment."
      />
    </div>
  );
}
