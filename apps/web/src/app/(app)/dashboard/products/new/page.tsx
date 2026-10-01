import type { Metadata } from "next";
import Link from "next/link";
import { NewProductForm } from "./NewProductForm";

export const metadata: Metadata = { title: "Nouveau produit — facture.gn" };

// Catalogue produits/services (docs/plans/2026-09-16-catalogue-produits-services.md).
// organizationId n'est jamais passé à ce composant : createProductAction le
// résout depuis la session (même discipline que le reste de la coquille),
// cette page n'a donc rien d'autre à charger avant de rendre le formulaire.
export default function NewProductPage() {
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-navy-950">Nouveau produit</h1>
        <Link href="/dashboard/products" className="text-sm font-medium text-navy-600 hover:text-navy-950">
          ← Retour
        </Link>
      </div>
      <NewProductForm />
    </div>
  );
}
