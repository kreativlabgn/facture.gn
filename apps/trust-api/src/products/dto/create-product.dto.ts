import { z } from "zod";

// E10 puis catalogue produits/services (2026-09-16) — costPrice reste
// volontairement absent : territoire d'E6 (coût d'achat), exclusivement posé
// via POST /products/:id/cost-price (setCostPrice), jamais fusionné ici
// (plan "Alternatives écartées"). taxExemptionCategory reste lui aussi hors
// DTO : aucun consommateur, domaine de valeurs non cadré, explicitement hors
// scope de ce chantier de catalogue (plan §Clarifications point 4).
//
// `type` EST en revanche du ressort de ce chantier : seul champ structurel
// obligatoire en plus de `name` (produit/service), immuable après création —
// voir update-product.dto.ts pour la garde d'immuabilité. `description` et
// `salePrice` sont optionnels : un marchand qui vend "sur devis" n'a pas de
// prix de vente à donner à la création.
export const createProductSchema = z.object({
  organizationId: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(["product", "service"]),
  description: z.string().trim().min(1).max(500).optional(),
  salePrice: z.coerce.bigint().nonnegative().optional(),
});

export type CreateProductDto = z.infer<typeof createProductSchema>;
