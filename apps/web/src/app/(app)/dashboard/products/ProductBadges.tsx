import { Badge } from "@/components/ui";
import type { ProductType } from "@/lib/trust-api";

// Libellés partagés entre la liste et l'écran détail/édition — un seul
// endroit à toucher si le vocabulaire change.
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  product: "Produit",
  service: "Service",
};

// Catalogue produits/services — "actif" est l'état normal d'une fiche, il n'a
// pas besoin de signal (même discipline que DisputeStatusPill : "none"
// n'affiche rien). Seul l'écart — "inactif" — est montré, en ton neutre
// (`navy`, registre "neutre/brouillon" de la Charte v1.3) : ce n'est jamais
// une erreur ni un rouge/vert de statut, juste un article retiré du
// catalogue sans toucher à l'historique de facturation déjà émis.
export function ProductActiveStatusBadge({ isActive }: { isActive: boolean }) {
  if (isActive) {
    return null;
  }
  return <Badge tone="navy">Inactif</Badge>;
}
